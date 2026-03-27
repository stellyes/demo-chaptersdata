# CLAUDE.md - Chapters Data Demo App (demo.chaptersdata.com)

This is the **demo** deployment of Chapters Data. It uses generalized store names
(Greenleaf Market, Emerald Collective) and seeded dummy data for client demonstrations.
Deployed at demo.chaptersdata.com via AWS Amplify.

## Project Overview

**Chapters Data** is a multi-tenant retail analytics and business intelligence platform for cannabis dispensaries. It serves as a centralized data hub that:
- Aggregates sales, brand, customer, and invoice data from multiple storefronts
- Provides AI-powered insights through autonomous daily/monthly learning systems
- Enables data-driven decision making through dashboards and analytics
- Manages vendor/brand normalization and inventory tracking
- Generates strategic reports using Claude AI

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.1.1, React 19.2.3 |
| Language | TypeScript 5.0+ (strict mode) |
| Database | AWS Aurora PostgreSQL + Prisma 5.22 |
| State | Zustand 5.0.10 with persistence |
| AI/LLM | Anthropic Claude (Sonnet 4, Haiku) |
| Web Search | SerpAPI |
| Styling | Tailwind CSS 4.1.18 |
| Charts | Recharts 3.6.0 |
| Storage | AWS S3 |
| Secrets | AWS Secrets Manager |
| Hosting | AWS Amplify |

## Project Structure

```
src/
├── app/
│   ├── api/                      # API routes
│   │   ├── auth/                 # Authentication
│   │   ├── ai/                   # AI/learning endpoints
│   │   │   ├── learning/         # Autonomous learning triggers
│   │   │   │   ├── run/          # POST - trigger learning job
│   │   │   │   ├── status/       # GET - poll job progress
│   │   │   │   ├── digest/       # GET - retrieve daily digest
│   │   │   │   ├── cancel/       # POST - cancel running job
│   │   │   │   └── auth.ts       # Shared auth (API key validation)
│   │   │   ├── insights/         # Insight generation
│   │   │   ├── buyer-insights/   # Purchasing intelligence
│   │   │   └── query/            # Custom queries
│   │   ├── data/                 # Data loading/management
│   │   ├── knowledge-base/       # Insights & knowledge
│   │   ├── qr/                   # QR code management
│   │   ├── seo/                  # SEO audit endpoints
│   │   └── admin/                # Admin operations
│   ├── actions/                  # Server actions
│   │   └── learning.ts           # runLearningJob() for frontend triggers
│   └── r/[shortCode]/            # QR redirect route
├── instrumentation.ts            # Next.js startup hook (Prisma init)
├── components/
│   ├── pages/                    # Full-page components
│   │   ├── DashboardPage/        # Main dashboard
│   │   ├── SalesAnalyticsPage/   # Sales analytics
│   │   ├── DataCenterPage/       # Data management
│   │   ├── InvoicesPage/         # Invoice browser
│   │   ├── ResearchPage/         # Research/insights
│   │   └── RecommendationsPage/  # AI recommendations
│   ├── charts/                   # Visualization components
│   ├── insights/                 # Insight components
│   ├── learning/                 # Learning progress UI
│   ├── layout/                   # Layout (sidebar, etc)
│   └── ui/                       # Reusable UI components
├── lib/
│   ├── services/                 # Core business logic
│   │   ├── claude.ts             # Claude AI integration
│   │   ├── daily-learning.ts     # 5-phase autonomous learning
│   │   ├── monthly-analysis.ts   # Monthly strategic analysis
│   │   ├── knowledge-base.ts     # Insight persistence
│   │   ├── data-correlations.ts  # Cross-data analysis
│   │   ├── data-health.ts        # Data quality monitoring
│   │   ├── web-search.ts         # SerpAPI integration
│   │   ├── content-fetcher.ts    # URL content extraction
│   │   └── seo-crawler.ts        # Website SEO analysis
│   ├── auth.ts                   # Authentication utilities
│   ├── config.ts                 # App configuration
│   ├── prisma.ts                 # Prisma singleton
│   └── secrets.ts                # AWS Secrets Manager
├── store/
│   └── app-store.ts              # Zustand global state (1300+ lines)
├── hooks/                        # React hooks
└── types/                        # TypeScript definitions

prisma/
├── schema.prisma                 # 46 database models
└── migrations/

scripts/
├── run-learning.sh               # CLI tool to trigger & monitor learning jobs
├── run-learning.ts               # TypeScript version of learning trigger
└── ...                           # Migration & utility scripts
terraform/                        # Infrastructure-as-code (Lambda, EventBridge)
config/                           # Vendor mapping configs
```

## Key Commands

```bash
npm run dev           # Start dev server
npm run build         # Production build with Prisma
npm run lint          # ESLint check
npm run db:seed       # Seed database
npm run sync-amplify  # Sync env vars to Amplify

# Learning Pipeline
./scripts/run-learning.sh              # Trigger & monitor learning job
./scripts/run-learning.sh --skip-web   # Skip web research phase
./scripts/run-learning.sh --monitor-only  # Monitor existing job
```

## Database Schema (46 Models)

**Core Business:**
- Organization, Storefront, UserMapping, UserProfile

**Retail Operations:**
- SalesRecord, BrandRecord, ProductRecord, Customer
- BudtenderRecord, BudtenderAssignment

**Purchasing:**
- Invoice, InvoiceLineItem, Vendor, VendorAlias
- CanonicalBrand, BrandAlias, VendorBrand

**AI & Learning:**
- DailyLearningJob, DailyDigest, MonthlyStrategicReport
- BusinessInsight, LearningQuestion, AnalysisHistory

**Knowledge & Research:**
- WebResearchCache, CollectedUrl, ResearchDocument
- ExternalFeed, ExternalFeedItem, RegulatoryEvent

**Infrastructure:**
- QrCode, QrClick, DataFlag, SeoAudit, ApiUsageTracker

## Architecture Patterns

### Multi-Tenant Structure
- Organizations → Storefronts → Users
- All queries include org_id filter
- Role-based access (admin/member)

### Autonomous Learning Pipeline (5 Phases)
```
Phase 1: Data Review (analyze 7 days of sales/brand data)
    ↓
Phase 2: Question Generation (5-10 research questions)
    ↓
Phase 3: Web Research (SerpAPI searches, up to 8)
    ↓
Phase 4: Data Correlations (cross-reference findings)
    ↓
Phase 5: Digest Generation (synthesize into DailyDigest)
```

### Progressive Data Loading
- **Eager:** Sales, brands, products, budtenders
- **Background:** Customers (830k+), invoices, research
- **Cached:** IndexedDB for large customer datasets

### Brand/Vendor Normalization
- Canonical names with alias mapping
- V2 structure: `{ canonicalBrand: { aliases: { aliasName: productType } } }`
- Supports purchase-side (vendor) and sales-side (brand) normalization

## Key Services

| Service | Purpose |
|---------|---------|
| `claude.ts` | Claude AI integration, specialized analyzers |
| `daily-learning.ts` | 5-phase autonomous learning (2100+ lines) |
| `monthly-analysis.ts` | Monthly strategic reports with SWOT |
| `knowledge-base.ts` | Insight persistence & discovery |
| `data-correlations.ts` | Cross-data analysis |
| `data-health.ts` | Data quality monitoring |
| `web-search.ts` | SerpAPI integration |
| `content-fetcher.ts` | URL content extraction |

## API Structure

**Data Loading:**
- `GET /api/data/load` - Sales, brands, products, budtenders
- `GET /api/data/customers` - Paginated customers (50k/page)
- `GET /api/data/invoices` - Paginated invoice line items
- `POST /api/data/load-aurora` - Load from Aurora via Prisma

**AI & Learning:**
- `POST /api/ai/learning/run` - Trigger daily learning
- `GET /api/ai/learning/status` - Check job status
- `GET /api/ai/learning/digest` - Retrieve daily digest
- `POST /api/ai/insights` - Generate insights
- `POST /api/ai/buyer-insights` - Purchasing intelligence

**Knowledge Base:**
- `GET /api/knowledge-base` - Query insights
- `GET /api/insights` - Get business insights
- `PATCH /api/insights` - Validate/deactivate insights

## State Management (Zustand)

The app uses a single Zustand store (`app-store.ts`) with:
- **Filters:** selectedStore, dateRange
- **Data:** sales, brands, products, customers, invoices
- **UI State:** currentPage, activeTab, darkMode
- **Persistence:** localStorage with selective field sync

```typescript
// Access store
const { sales, selectedStore, setDateRange } = useAppStore()

// Filtered selectors use deferred values to prevent blocking
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Database fields | snake_case (mapped) | `created_at → createdAt` |
| Components | PascalCase | `DashboardPage.tsx` |
| Hooks | use prefix | `useAuth`, `useProfile` |
| Services | camelCase | `dailyLearning.ts` |
| Env vars | SCREAMING_SNAKE | `DATABASE_URL` |

## API Response Pattern

```typescript
{
  success: boolean,
  data?: T,
  error?: string,
  pagination?: { totalCount, hasMore }
}
```

## Performance Patterns

- Deferred values in Zustand selectors
- Memoized filtered data
- Pagination for large datasets (customers, invoices)
- IndexedDB caching for 830k+ customer records
- 5-minute data cache with hash invalidation
- Timeout wrappers (60s DB, 2min Claude API)

## AI Prompting Patterns

- System prompts define role (cannabis retail analyst)
- Token budgets per phase (8k-16k)
- Structured JSON outputs with validation
- Progressive context (50 past questions, 25 insights, 14 day digests)
- Chain-of-thought for complex reasoning

## Environment Variables

Key env vars (see `.env.example`):
- `DATABASE_URL`: Aurora PostgreSQL connection
- `ANTHROPIC_API_KEY`: Claude API key
- `SERPAPI_API_KEY`: Web search API (250 searches/month quota)
- `LEARNING_API_KEY`: Auth key for learning pipeline endpoints
- `S3_*`: S3 bucket configuration
- `NEXT_PUBLIC_COGNITO_*`: Cognito config

## Common Tasks

### Adding a new API endpoint
1. Create route in `src/app/api/[endpoint]/route.ts`
2. Import Prisma via `initializePrisma()` for credential handling
3. Use try-catch with timeout wrappers
4. Return `{ success, data }` or `{ success: false, error }`

### Adding a new AI analysis
1. Add function to `src/lib/services/claude.ts`
2. Define system prompt and token budget
3. Use `generateResponseWithUsage()` for token tracking
4. Add corresponding API endpoint if needed

### Running autonomous learning

**From CLI:**
```bash
./scripts/run-learning.sh  # Triggers job, streams logs, monitors progress
```

**From Frontend (Server Action):**
```typescript
import { runLearningJob } from '@/app/actions/learning';
const result = await runLearningJob({ forceRun: true, skipWebResearch: false });
// Returns immediately, frontend polls /api/ai/learning/status
```

**Direct API:**
```bash
# Trigger (requires X-API-Key header)
curl -X POST https://bcsf.chaptersdata.com/api/ai/learning/run \
  -H "X-API-Key: $LEARNING_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"forceRun": true}'

# Poll status
curl https://bcsf.chaptersdata.com/api/ai/learning/status \
  -H "X-API-Key: $LEARNING_API_KEY"
```

**Architecture:** Jobs run synchronously on Amplify Lambda (keeps Lambda alive). Server action fires request with 15s timeout, returns immediately while Lambda continues execution. Frontend polls status endpoint for real-time progress.

### Working with the store
```typescript
// Read state
const sales = useAppStore(state => state.sales)

// Update state
useAppStore.getState().setSales(newSales)

// Filtered data (uses deferred values)
const filteredSales = useAppStore(state => state.getFilteredSales())
```

## Data Scale

- **Customers:** 830k+ records
- **Invoice Line Items:** 500k+
- **Daily Sales Records:** 2k+
- **Stores:** 2 (Greenleaf Market, Emerald Collective) + combined view
