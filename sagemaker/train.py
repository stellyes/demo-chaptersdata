"""
SageMaker Training Script: Cannabis Compliance Classifier

Fine-tunes DistilBERT for multi-label compliance risk classification
on sales transaction data.

Input: JSONL files with {text, labels, jurisdiction, source} records
Output: model.tar.gz with fine-tuned model + tokenizer + label map

Usage (SageMaker):
    Invoked automatically by the chapters-compliance-train-trigger Lambda
    via HuggingFace Estimator.

Usage (local testing):
    python train.py --train_data ./data/train.jsonl \
                    --val_data ./data/validation.jsonl \
                    --output_dir ./output \
                    --epochs 5 --train_batch_size 32
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset
from sklearn.metrics import f1_score, precision_score, recall_score
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
    EvalPrediction,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ─── Label Definitions ───────────────────────────────────────────────────────

ALL_LABELS = [
    "compliant",
    "thc_limit_violation",
    "cbd_limit_violation",
    "missing_tracking",
    "age_verification_issue",
    "quantity_limit_violation",
    "tax_discrepancy",
    "naming_violation",
    "hours_violation",
    "pricing_anomaly",
    "distributor_issue",
]

LABEL2ID = {label: idx for idx, label in enumerate(ALL_LABELS)}
ID2LABEL = {idx: label for idx, label in enumerate(ALL_LABELS)}
NUM_LABELS = len(ALL_LABELS)


# ─── Dataset ─────────────────────────────────────────────────────────────────

class ComplianceDataset(Dataset):
    """Multi-label compliance classification dataset from JSONL files."""

    def __init__(self, file_path: str, tokenizer, max_length: int = 256):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.texts = []
        self.labels = []

        logger.info(f"Loading dataset from {file_path}")
        with open(file_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    self.texts.append(record["text"])

                    # Convert label names to multi-hot vector
                    label_vec = [0.0] * NUM_LABELS
                    for label_name in record.get("labels", []):
                        if label_name in LABEL2ID:
                            label_vec[LABEL2ID[label_name]] = 1.0
                    self.labels.append(label_vec)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"Skipping malformed record: {e}")
                    continue

        logger.info(f"Loaded {len(self.texts)} examples from {file_path}")

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        encoding = self.tokenizer(
            self.texts[idx],
            max_length=self.max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(),
            "attention_mask": encoding["attention_mask"].squeeze(),
            "labels": torch.tensor(self.labels[idx], dtype=torch.float),
        }


# ─── Metrics ─────────────────────────────────────────────────────────────────

def compute_metrics(eval_pred: EvalPrediction) -> dict:
    """Compute multi-label classification metrics."""
    logits = eval_pred.predictions
    labels = eval_pred.label_ids

    # Apply sigmoid and threshold at 0.5
    probs = 1 / (1 + np.exp(-logits))
    preds = (probs >= 0.5).astype(int)

    # Macro-averaged metrics across all labels
    f1_macro = f1_score(labels, preds, average="macro", zero_division=0)
    f1_micro = f1_score(labels, preds, average="micro", zero_division=0)
    precision = precision_score(labels, preds, average="macro", zero_division=0)
    recall = recall_score(labels, preds, average="macro", zero_division=0)

    # Per-label F1 for analysis
    per_label_f1 = f1_score(labels, preds, average=None, zero_division=0)
    per_label = {
        f"f1_{ALL_LABELS[i]}": float(per_label_f1[i])
        for i in range(min(len(ALL_LABELS), len(per_label_f1)))
    }

    return {
        "f1_macro": f1_macro,
        "f1_micro": f1_micro,
        "precision_macro": precision,
        "recall_macro": recall,
        **per_label,
    }


# ─── Training ────────────────────────────────────────────────────────────────

def train(args):
    logger.info(f"Starting training with args: {args}")

    # Load tokenizer and model
    model_name = args.model_name
    logger.info(f"Loading model: {model_name}")

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=NUM_LABELS,
        problem_type="multi_label_classification",
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )

    # Load datasets
    train_dataset = ComplianceDataset(args.train_data, tokenizer, args.max_length)
    val_dataset = ComplianceDataset(args.val_data, tokenizer, args.max_length)

    logger.info(f"Train: {len(train_dataset)} examples, Val: {len(val_dataset)} examples")

    # Training arguments
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.train_batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        warmup_ratio=0.1,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1_macro",
        greater_is_better=True,
        logging_steps=50,
        save_total_limit=2,
        fp16=torch.cuda.is_available(),
        dataloader_num_workers=2,
        report_to="none",
    )

    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
    )

    # Train
    logger.info("Starting training loop...")
    train_result = trainer.train()
    logger.info(f"Training complete. Metrics: {train_result.metrics}")

    # Evaluate
    eval_result = trainer.evaluate()
    logger.info(f"Evaluation metrics: {eval_result}")

    # Save the best model
    model_output = os.path.join(args.output_dir, "model")
    trainer.save_model(model_output)
    tokenizer.save_pretrained(model_output)

    # Save label map alongside model
    with open(os.path.join(model_output, "label_map.json"), "w") as f:
        json.dump({"labels": ALL_LABELS, "label2id": LABEL2ID, "id2label": ID2LABEL}, f, indent=2)

    # Save training metrics
    metrics = {
        "train": train_result.metrics,
        "eval": eval_result,
        "model_name": model_name,
        "num_labels": NUM_LABELS,
        "train_examples": len(train_dataset),
        "val_examples": len(val_dataset),
        "epochs": args.epochs,
        "learning_rate": args.learning_rate,
        "batch_size": args.train_batch_size,
    }
    with open(os.path.join(args.output_dir, "training-metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    logger.info(f"Model saved to {model_output}")
    logger.info(f"Final F1 macro: {eval_result.get('eval_f1_macro', 'N/A')}")

    return metrics


# ─── Entry Point ─────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="Train compliance classifier")

    # SageMaker environment variables (set automatically by SageMaker)
    parser.add_argument("--model_name", type=str, default="distilbert-base-uncased")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--train_batch_size", type=int, default=32)
    parser.add_argument("--eval_batch_size", type=int, default=64)
    parser.add_argument("--learning_rate", type=float, default=2e-5)
    parser.add_argument("--max_length", type=int, default=256)
    parser.add_argument("--num_labels", type=int, default=NUM_LABELS)

    # Data paths (SageMaker sets these via SM_CHANNEL_*)
    parser.add_argument(
        "--train_data",
        type=str,
        default=os.environ.get("SM_CHANNEL_TRAIN", "/opt/ml/input/data/train") + "/train.jsonl",
    )
    parser.add_argument(
        "--val_data",
        type=str,
        default=os.environ.get("SM_CHANNEL_VALIDATION", "/opt/ml/input/data/validation") + "/validation.jsonl",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=os.environ.get("SM_MODEL_DIR", "/opt/ml/model"),
    )

    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    metrics = train(args)
    logger.info("Training complete!")
    sys.exit(0)
