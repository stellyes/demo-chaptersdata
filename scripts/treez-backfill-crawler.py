"""
Treez Backfill Crawler
Exports Product Summary + Discount reports for specified date ranges from both stores.
Uploads CSVs to S3 (treez-data-export bucket).

Usage:
  python3 scripts/treez-backfill-crawler.py --store barbarycoast --start 2026-03-19 --end 2026-03-23
  python3 scripts/treez-backfill-crawler.py --store grassroots --start 2026-03-16 --end 2026-03-23
  python3 scripts/treez-backfill-crawler.py --all  # runs both stores with auto-detected date ranges
"""

import ssl
ssl._create_default_https_context = ssl._create_unverified_context

import os
import sys
import json
import time
import glob
import shutil
import argparse
from datetime import datetime, timedelta

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, StaleElementReferenceException,
    WebDriverException
)
from webdriver_manager.chrome import ChromeDriverManager
import boto3

# --- Config ---
S3_BUCKET = "treez-data-export"
S3_REGION = "us-west-1"
DOWNLOAD_DIR = "/tmp/treez-backfill"
WAIT_TIMEOUT = 30
REPORT_LOAD_TIMEOUT = 120  # reports can take a while

# XPaths
XPATH_DATE_PICKER = "/html/body/main/div/div[5]/div/div/div[3]/div[2]/div[1]/div/div"
XPATH_START_DATE_INPUT = "/html/body/div[4]/div/div[1]/div[2]/span[1]/span/div/input"
XPATH_END_DATE_INPUT = "/html/body/div[4]/div/div[1]/div[2]/span[2]/span/div/input"
XPATH_GENERATE_REPORT = "/html/body/main/div/div[5]/div/div/div[3]/div[2]/button"
XPATH_DISCOUNT_TAB = "/html/body/main/div/div[5]/div/div/div[1]/div/div[2]/div/div[1]/button[2]/div/div"

# Login XPaths
XPATH_EMAIL = '//*[@id="Email"]'
XPATH_PASSWORD = '//*[@id="Password"]'
XPATH_LOGIN_BTN = '//*[@id="root"]/div/div/div/form/div[4]/button'

STORE_CONFIGS = {
    "barbarycoast": {
        "prefix": "barbarycoast",
        "report_url": "https://barbarycoast.treez.io/portalDispensary/portal/ProductsReport",
        "s3_product_prefix": "exports",
        "s3_discount_prefix": "exports/discounts",
    },
    "grassroots": {
        "prefix": "grassroots",
        "report_url": "https://grassroots.treez.io/portalDispensary/portal/ProductsReport",
        "s3_product_prefix": "exports/grassroots",
        "s3_discount_prefix": "exports/grassroots/discounts",
    },
}


def get_credentials():
    """Fetch Treez credentials from AWS Secrets Manager."""
    client = boto3.client("secretsmanager", region_name=S3_REGION)
    secret = json.loads(
        client.get_secret_value(SecretId="treez-io-credentials")["SecretString"]
    )
    return secret["email"], secret["password"]


def clear_download_dir():
    """Remove all CSVs from download directory."""
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(DOWNLOAD_DIR, "*.csv")):
        os.remove(f)


def wait_for_download(timeout=60):
    """Wait for a CSV file to appear in the download dir."""
    start = time.time()
    while time.time() - start < timeout:
        csvs = glob.glob(os.path.join(DOWNLOAD_DIR, "*.csv"))
        # Filter out partial downloads (.crdownload)
        crdownloads = glob.glob(os.path.join(DOWNLOAD_DIR, "*.crdownload"))
        if csvs and not crdownloads:
            # Return the newest CSV
            return max(csvs, key=os.path.getmtime)
        time.sleep(1)
    return None


def create_driver():
    """Create a fresh Chrome WebDriver."""
    opts = Options()
    opts.add_argument("--window-size=1920,1200")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    prefs = {
        "download.default_directory": DOWNLOAD_DIR,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    }
    opts.add_experimental_option("prefs", prefs)

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=opts,
    )
    driver.execute_cdp_cmd(
        "Page.setDownloadBehavior",
        {"behavior": "allow", "downloadPath": DOWNLOAD_DIR},
    )
    return driver


def login(driver, email, password):
    """Log in to Treez."""
    print("  Logging in to Treez...")
    driver.get("https://app.treez.io")
    time.sleep(4)

    try:
        email_field = WebDriverWait(driver, WAIT_TIMEOUT).until(
            EC.presence_of_element_located((By.XPATH, XPATH_EMAIL))
        )
        email_field.clear()
        email_field.send_keys(email)

        pw_field = driver.find_element(By.XPATH, XPATH_PASSWORD)
        pw_field.clear()
        pw_field.send_keys(password)

        driver.find_element(By.XPATH, XPATH_LOGIN_BTN).click()
        time.sleep(8)
        print("  Login successful")
        return True
    except Exception as e:
        print(f"  Login failed: {e}")
        return False


def is_logged_out(driver):
    """Check if we got redirected to login page."""
    url = driver.current_url.lower()
    return "app.treez.io" in url and "portal" not in url


def ensure_logged_in(driver, email, password, store_config):
    """Navigate to report page, re-login if needed."""
    driver.get(store_config["report_url"])
    time.sleep(5)

    if is_logged_out(driver):
        print("  Session expired, re-logging in...")
        if not login(driver, email, password):
            return False
        driver.get(store_config["report_url"])
        time.sleep(10)

    # Wait for page to fully load by checking for the generate button
    try:
        WebDriverWait(driver, WAIT_TIMEOUT).until(
            EC.element_to_be_clickable((By.XPATH, XPATH_GENERATE_REPORT))
        )
        return True
    except TimeoutException:
        # Might need to re-login
        if is_logged_out(driver):
            login(driver, email, password)
            driver.get(store_config["report_url"])
            time.sleep(10)
            try:
                WebDriverWait(driver, WAIT_TIMEOUT).until(
                    EC.element_to_be_clickable((By.XPATH, XPATH_GENERATE_REPORT))
                )
                return True
            except:
                return False
        return False


def set_date_range(driver, date_str):
    """Set both start and end date to the same date (single day export)."""
    # Click date picker to open it
    date_picker = WebDriverWait(driver, WAIT_TIMEOUT).until(
        EC.element_to_be_clickable((By.XPATH, XPATH_DATE_PICKER))
    )
    date_picker.click()
    time.sleep(2)

    # Set start date
    start_input = WebDriverWait(driver, WAIT_TIMEOUT).until(
        EC.presence_of_element_located((By.XPATH, XPATH_START_DATE_INPUT))
    )
    start_input.click()
    time.sleep(0.5)
    # Triple-click to select all, then type
    start_input.send_keys(Keys.CONTROL + "a")
    start_input.send_keys(Keys.COMMAND + "a")
    time.sleep(0.3)
    start_input.send_keys(date_str)
    time.sleep(0.5)

    # Set end date
    end_input = driver.find_element(By.XPATH, XPATH_END_DATE_INPUT)
    end_input.click()
    time.sleep(0.5)
    end_input.send_keys(Keys.CONTROL + "a")
    end_input.send_keys(Keys.COMMAND + "a")
    time.sleep(0.3)
    end_input.send_keys(date_str)
    time.sleep(0.5)

    # Press Escape to close the date picker
    driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
    time.sleep(1)


def generate_report(driver):
    """Click the Generate Report button and wait for data to load."""
    btn = WebDriverWait(driver, WAIT_TIMEOUT).until(
        EC.element_to_be_clickable((By.XPATH, XPATH_GENERATE_REPORT))
    )
    btn.click()
    print("    Waiting for report to generate...")
    time.sleep(15)  # Reports take time to load


def click_more_and_export(driver):
    """Click the 'More' button (svg#more-btn) and then 'Export CSV' to download."""
    XPATH_EXPORT_CSV = "/html/body/div[4]/div/div/div/div/div/div/span"

    try:
        # svg#more-btn exists but SVG elements can't be clicked directly -
        # use the parent div container instead
        more_svg = WebDriverWait(driver, WAIT_TIMEOUT).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "svg#more-btn"))
        )
        # Get the parent clickable container
        parent = more_svg.find_element(By.XPATH, "./..")
        # Use ActionChains to click on the parent element
        from selenium.webdriver.common.action_chains import ActionChains
        ActionChains(driver).move_to_element(parent).click().perform()
        time.sleep(2)
    except Exception as e:
        print(f"    WARNING: Could not find/click More button: {e}")
        return False

    try:
        export_btn = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, XPATH_EXPORT_CSV))
        )
        export_btn.click()
        time.sleep(3)
        return True
    except Exception as e:
        # Fallback: look for any visible element with "Export" text
        try:
            for el in driver.find_elements(By.XPATH, "//*[contains(text(), 'Export')]"):
                if el.is_displayed():
                    el.click()
                    time.sleep(3)
                    return True
        except:
            pass
        print(f"    WARNING: Could not find/click Export CSV: {e}")
        return False


def upload_to_s3(filepath, s3_prefix, date_obj):
    """Upload a CSV file to S3."""
    s3 = boto3.client("s3", region_name=S3_REGION)
    filename = os.path.basename(filepath)
    date_folder = date_obj.strftime("%Y/%m/%d")
    s3_key = f"{s3_prefix}/{date_folder}/{filename}"

    print(f"    Uploading to s3://{S3_BUCKET}/{s3_key}")
    s3.upload_file(filepath, S3_BUCKET, s3_key)
    return s3_key


def switch_to_discount_tab(driver):
    """Click the Discount tab on the report page."""
    try:
        discount_tab = WebDriverWait(driver, WAIT_TIMEOUT).until(
            EC.element_to_be_clickable((By.XPATH, XPATH_DISCOUNT_TAB))
        )
        discount_tab.click()
        time.sleep(3)
        return True
    except Exception as e:
        print(f"    WARNING: Could not switch to discount tab: {e}")
        return False


def export_report_for_date(driver, date_obj, report_type, s3_prefix, email, password, store_config):
    """
    Export a single report (product or discount) for a single date.
    Returns the S3 key if successful, None otherwise.
    """
    date_str = date_obj.strftime("%m/%d/%Y")
    date_label = date_obj.strftime("%Y-%m-%d")
    print(f"  [{date_label}] Exporting {report_type} report...")

    try:
        # Clear downloads
        clear_download_dir()

        # Set date range
        set_date_range(driver, date_str)

        # Generate report
        generate_report(driver)

        # Export via More > Export
        if not click_more_and_export(driver):
            print(f"    FAILED: Could not export {report_type} for {date_label}")
            return None

        # Wait for download
        csv_path = wait_for_download(timeout=60)
        if not csv_path:
            print(f"    FAILED: Download timed out for {report_type} {date_label}")
            return None

        file_size = os.path.getsize(csv_path)
        print(f"    Downloaded: {os.path.basename(csv_path)} ({file_size:,} bytes)")

        # Upload to S3
        # S3 key uses the next day's folder (matching the nightly export convention)
        next_day = date_obj + timedelta(days=1)
        s3_key = upload_to_s3(csv_path, s3_prefix, next_day)
        return s3_key

    except Exception as e:
        print(f"    ERROR exporting {report_type} for {date_label}: {e}")
        # Check if we got logged out
        if is_logged_out(driver):
            print("    Session expired, will re-login on next attempt")
        return None


def backfill_store(store_name, start_date, end_date):
    """Run the full backfill for one store."""
    config = STORE_CONFIGS[store_name]
    email, password = get_credentials()

    print(f"\n{'='*60}")
    print(f"Backfilling {store_name}")
    print(f"Date range: {start_date} to {end_date}")
    print(f"Report URL: {config['report_url']}")
    print(f"{'='*60}\n")

    driver = create_driver()
    results = {"product": [], "discount": [], "failed": []}

    try:
        # Initial login
        if not login(driver, email, password):
            print("FATAL: Could not log in")
            return results

        current = start_date
        while current <= end_date:
            date_label = current.strftime("%Y-%m-%d")
            print(f"\n--- {date_label} ---")

            # Navigate to report page (Product Summary tab is default)
            if not ensure_logged_in(driver, email, password, config):
                print(f"  SKIP {date_label}: Could not load report page")
                results["failed"].append((date_label, "product", "page_load"))
                results["failed"].append((date_label, "discount", "page_load"))
                current += timedelta(days=1)
                continue

            time.sleep(3)

            # 1. Export Product Summary
            s3_key = export_report_for_date(
                driver, current, "product",
                config["s3_product_prefix"],
                email, password, config
            )
            if s3_key:
                results["product"].append((date_label, s3_key))
            else:
                results["failed"].append((date_label, "product", "export_failed"))

            # 2. Refresh and switch to Discount tab
            print(f"  [{date_label}] Refreshing page for discount report...")
            driver.refresh()
            time.sleep(8)

            # Check if still logged in after refresh
            if is_logged_out(driver):
                if not ensure_logged_in(driver, email, password, config):
                    print(f"  SKIP {date_label} discount: Could not re-login")
                    results["failed"].append((date_label, "discount", "login_failed"))
                    current += timedelta(days=1)
                    continue

            # Wait for page to load
            try:
                WebDriverWait(driver, WAIT_TIMEOUT).until(
                    EC.element_to_be_clickable((By.XPATH, XPATH_GENERATE_REPORT))
                )
            except:
                print(f"  SKIP {date_label} discount: Page didn't load")
                results["failed"].append((date_label, "discount", "page_load"))
                current += timedelta(days=1)
                continue

            # Switch to discount tab
            if not switch_to_discount_tab(driver):
                results["failed"].append((date_label, "discount", "tab_switch"))
                current += timedelta(days=1)
                continue

            time.sleep(3)

            # Export Discount report
            try:
                s3_key = export_report_for_date(
                    driver, current, "discount",
                    config["s3_discount_prefix"],
                    email, password, config
                )
            except Exception as e:
                print(f"    ERROR during discount export: {e}")
                s3_key = None
            if s3_key:
                results["discount"].append((date_label, s3_key))
            else:
                results["failed"].append((date_label, "discount", "export_failed"))

            current += timedelta(days=1)

            # Small delay between days to be nice to the server
            time.sleep(2)

    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
    finally:
        try:
            driver.quit()
        except:
            pass

    return results


def print_results(store_name, results):
    """Print a summary of the backfill results."""
    print(f"\n{'='*60}")
    print(f"Results for {store_name}")
    print(f"{'='*60}")
    print(f"Product reports exported:  {len(results['product'])}")
    for date, key in results["product"]:
        print(f"  ✓ {date} -> {key}")
    print(f"Discount reports exported: {len(results['discount'])}")
    for date, key in results["discount"]:
        print(f"  ✓ {date} -> {key}")
    if results["failed"]:
        print(f"Failed: {len(results['failed'])}")
        for date, rtype, reason in results["failed"]:
            print(f"  ✗ {date} {rtype}: {reason}")


CHECKPOINT_FILE = os.path.join(DOWNLOAD_DIR, "checkpoint.json")

STORE_DB_NAMES = {
    "barbarycoast": "Barbary Coast - SF Mission",
    "grassroots": "Grass Roots - SF",
}


def load_checkpoint():
    """Load completed dates from checkpoint file for resume-on-interrupt."""
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"completed": {}}


def save_checkpoint(checkpoint):
    """Save completed dates to checkpoint file."""
    os.makedirs(os.path.dirname(CHECKPOINT_FILE), exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(checkpoint, f, indent=2)


def detect_latest_ingested(store_name):
    """
    Query Aurora for the latest date_open in sales_line_items for a store.
    Returns a datetime or None if no connection available.
    Requires DATABASE_URL env var.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return None
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        db_store = STORE_DB_NAMES.get(store_name)
        if not db_store:
            return None
        cur.execute(
            "SELECT MAX(date_open)::date FROM sales_line_items WHERE store_name = %s",
            (db_store,),
        )
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            return datetime.combine(row[0], datetime.min.time())
        return None
    except Exception as e:
        print(f"  WARNING: Could not query database for latest date: {e}")
        return None


def detect_gap_dates(store_name):
    """
    Query Aurora for dates that exist in sales_records but not in sales_line_items.
    Returns a sorted list of datetime objects representing missing dates.
    Requires DATABASE_URL env var.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return []
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        store_id = "barbary_coast" if store_name == "barbarycoast" else "grass_roots"
        db_store = STORE_DB_NAMES.get(store_name)

        cur.execute("""
            SELECT sr.date::date
            FROM sales_records sr
            LEFT JOIN (
                SELECT DISTINCT date_open::date as d
                FROM sales_line_items
                WHERE store_name = %s
            ) sli ON sr.date::date = sli.d
            WHERE sr.store_id = %s
              AND sli.d IS NULL
            ORDER BY sr.date
        """, (db_store, store_id))

        rows = cur.fetchall()
        conn.close()
        return [datetime.combine(r[0], datetime.min.time()) for r in rows if r[0]]
    except Exception as e:
        print(f"  WARNING: Could not query database for gaps: {e}")
        return []


def main():
    parser = argparse.ArgumentParser(description="Treez Backfill Crawler")
    parser.add_argument("--store", choices=["barbarycoast", "grassroots", "both"], default="both",
                        help="Which store to backfill")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--all", action="store_true",
                        help="Run both stores — auto-detects date range from DB (latest ingested → yesterday)")
    parser.add_argument("--gap-fill", action="store_true",
                        help="Fill gaps: export dates that have sales_records but no line items")
    parser.add_argument("--resume", action="store_true",
                        help="Skip dates already in checkpoint file (for resuming interrupted backfills)")
    parser.add_argument("--max-days", type=int, default=0,
                        help="Maximum number of days to process per store (0 = unlimited)")
    args = parser.parse_args()

    checkpoint = load_checkpoint() if args.resume else {"completed": {}}

    if args.gap_fill:
        # Gap-fill mode: query DB for dates with aggregates but no line items
        target_stores = ["barbarycoast", "grassroots"] if args.store == "both" else [args.store]
        stores_to_run = []
        for store_name in target_stores:
            gap_dates = detect_gap_dates(store_name)
            if not gap_dates:
                print(f"No gaps detected for {store_name} (or DB not reachable)")
                continue

            # Filter out already-completed dates from checkpoint
            if args.resume and store_name in checkpoint["completed"]:
                done = set(checkpoint["completed"][store_name])
                gap_dates = [d for d in gap_dates if d.strftime("%Y-%m-%d") not in done]

            if args.max_days > 0:
                # Process most recent gaps first (highest value)
                gap_dates = sorted(gap_dates, reverse=True)[:args.max_days]
                gap_dates.sort()

            if gap_dates:
                print(f"{store_name}: {len(gap_dates)} gap dates to fill")
                # Group consecutive dates into ranges for efficiency
                stores_to_run.append((store_name, gap_dates))

        if not stores_to_run:
            print("No gaps to fill.")
            return

        # Process gap dates individually (they may not be consecutive)
        all_results = {}
        for store_name, dates in stores_to_run:
            config = STORE_CONFIGS[store_name]
            email, password = get_credentials()
            driver = create_driver()
            results = {"product": [], "discount": [], "failed": []}

            try:
                if not login(driver, email, password):
                    print(f"FATAL: Could not log in for {store_name}")
                    all_results[store_name] = results
                    continue

                for date_obj in dates:
                    date_label = date_obj.strftime("%Y-%m-%d")
                    print(f"\n--- {date_label} ---")

                    if not ensure_logged_in(driver, email, password, config):
                        results["failed"].append((date_label, "product", "page_load"))
                        continue

                    time.sleep(3)

                    s3_key = export_report_for_date(
                        driver, date_obj, "product",
                        config["s3_product_prefix"],
                        email, password, config
                    )
                    if s3_key:
                        results["product"].append((date_label, s3_key))
                    else:
                        results["failed"].append((date_label, "product", "export_failed"))

                    # Save checkpoint after each successful date
                    if store_name not in checkpoint["completed"]:
                        checkpoint["completed"][store_name] = []
                    checkpoint["completed"][store_name].append(date_label)
                    save_checkpoint(checkpoint)

                    time.sleep(2)
            except KeyboardInterrupt:
                print("\n\nInterrupted by user — checkpoint saved")
                save_checkpoint(checkpoint)
            finally:
                try:
                    driver.quit()
                except:
                    pass

            all_results[store_name] = results
            print_results(store_name, results)

        return

    if args.all:
        # Auto-detect: crawl from latest ingested date → yesterday
        yesterday = datetime.now() - timedelta(days=1)
        stores_to_run = []
        target_stores = ["barbarycoast", "grassroots"] if args.store == "both" else [args.store]

        for store_name in target_stores:
            latest = detect_latest_ingested(store_name)
            if latest:
                start = latest + timedelta(days=1)
                if start <= yesterday:
                    stores_to_run.append((store_name, start, yesterday))
                    print(f"{store_name}: detected latest={latest.strftime('%Y-%m-%d')}, crawling {start.strftime('%Y-%m-%d')} → {yesterday.strftime('%Y-%m-%d')}")
                else:
                    print(f"{store_name}: already up to date (latest={latest.strftime('%Y-%m-%d')})")
            else:
                # Fallback: last 7 days
                start = yesterday - timedelta(days=6)
                stores_to_run.append((store_name, start, yesterday))
                print(f"{store_name}: no DB connection, defaulting to last 7 days")
    else:
        if not args.start or not args.end:
            parser.error("--start and --end are required unless using --all or --gap-fill")
        start = datetime.strptime(args.start, "%Y-%m-%d")
        end = datetime.strptime(args.end, "%Y-%m-%d")

        if args.store == "both":
            stores_to_run = [
                ("barbarycoast", start, end),
                ("grassroots", start, end),
            ]
        else:
            stores_to_run = [(args.store, start, end)]

    all_results = {}
    for store_name, start_date, end_date in stores_to_run:
        results = backfill_store(store_name, start_date, end_date)
        all_results[store_name] = results
        print_results(store_name, results)

    # Final summary
    print(f"\n{'='*60}")
    print("BACKFILL COMPLETE")
    print(f"{'='*60}")
    total_product = sum(len(r["product"]) for r in all_results.values())
    total_discount = sum(len(r["discount"]) for r in all_results.values())
    total_failed = sum(len(r["failed"]) for r in all_results.values())
    print(f"Total product exports:  {total_product}")
    print(f"Total discount exports: {total_discount}")
    print(f"Total failures:         {total_failed}")


if __name__ == "__main__":
    main()
