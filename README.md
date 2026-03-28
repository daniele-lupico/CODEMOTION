# ContractAI — Contract Intelligence Platform

> AI-powered contract analysis platform for Italian B2B enterprises.
> Upload a PDF or DOCX contract and get instant legal analysis, risk scoring, interactive charts, voice synthesis, and a per-user chat history — all in a dark-themed enterprise UI.

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Architecture Overview](#2-architecture-overview)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Backend — File-by-File](#5-backend--file-by-file)
   - [Entry Point & Configuration](#entry-point--configuration)
   - [Data Models](#data-models)
   - [Routes (API Endpoints)](#routes-api-endpoints)
   - [Services (Business Logic)](#services-business-logic)
   - [Data Files](#data-files)
6. [Frontend — File-by-File](#6-frontend--file-by-file)
7. [Key Data Flows](#7-key-data-flows)
8. [Setup & Running Locally](#8-setup--running-locally)
9. [Environment Variables](#9-environment-variables)
10. [Full API Reference](#10-full-api-reference)

---

## 1. What This Is

ContractAI is a two-part application:

- **Backend**: A FastAPI Python server that accepts contract documents, extracts structured legal data using an LLM (via Regolo AI, an OpenAI-compatible gateway), stores everything in flat JSON files, and exposes a REST API.
- **Frontend**: A Vite + vanilla JavaScript single-page app that provides a chat interface, sidebar with folder management, interactive Chart.js visualizations, voice synthesis, and Google Calendar integration.

The product is designed for Italian SMEs (PMI) who need to review supplier contracts without hiring a dedicated legal team. The AI reads the contract and answers questions about it in Italian, citing specific clauses.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     BROWSER (port 5173)                  │
│                                                          │
│  landing.html ──► index.html ──► src/main.js            │
│  (auth / register)  (chat app)   (all logic)            │
│                                                          │
│  localStorage: cai_token, cai_user_id, cai_company      │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP (fetch)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  FastAPI (port 8000)                     │
│                                                          │
│  /api/upload  ──► parser ──► extractor ──► contracts.json│
│  /api/chat    ──► citation prompt ──► Regolo AI LLM     │
│  /api/auth/*  ──► users.json                            │
│  /api/chats/* ──► chats.json                            │
│  /api/folders/*──► folders.json + chats.json            │
│  /api/stats   ──► stats.json                            │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS
                        ▼
              Regolo AI (api.regolo.ai)
              Model: qwen3-coder-next
              (OpenAI-compatible API)
```

---

## 3. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Backend framework | **FastAPI** | Async, type-safe, auto-docs at `/docs` |
| AI gateway | **Regolo AI** (OpenAI SDK) | Italian LLM hosting, OpenAI-compatible |
| LLM model | **qwen3-coder-next** | Used for both extraction and chat |
| PDF parsing | **PyMuPDF (fitz)** | Fast, reliable text extraction |
| DOCX parsing | **python-docx** | Standard Word document support |
| Data storage | **JSON flat files** | Zero-dependency, easy to inspect |
| Voice synthesis | **ElevenLabs** | Multilingual TTS for Italian text |
| Frontend bundler | **Vite 8** | Fast HMR, ES module native |
| Charts | **Chart.js 4** | Bar, line, doughnut charts in canvas |
| Fonts | **Inter (Google Fonts)** | Clean, enterprise-grade typography |

---

## 4. Project Structure

```
CODEMOTION/
├── backend/
│   ├── main.py                  # FastAPI app entry point, router registration
│   ├── config.py                # File paths and env variable loading
│   ├── models.py                # Pydantic request/response schemas
│   ├── routes/
│   │   ├── documents.py         # /api/upload, /api/contracts
│   │   ├── chat.py              # /api/chat, /api/tts, /api/calendar/schedule
│   │   ├── chats.py             # /api/chats/* (chat history per user)
│   │   ├── auth.py              # /api/auth/* (register, login, verify)
│   │   ├── analytics.py         # /api/dashboard/overview, /api/analytics/portfolio, /api/stats
│   │   ├── folders.py           # /api/folders/* (folder CRUD + move chats)
│   │   └── projects.py          # /api/projects (placeholder)
│   ├── services/
│   │   ├── parser.py            # PDF/DOCX text extraction
│   │   ├── extractor.py         # LLM-based contract field extraction
│   │   ├── citation.py          # System prompt builder for chat AI
│   │   ├── risk_engine.py       # Portfolio risk calculations (pure Python)
│   │   ├── cost_tracker.py      # Token cost and ROI tracking
│   │   ├── elevenlabs.py        # ElevenLabs TTS API wrapper
│   │   └── model_selector.py    # Chooses Haiku vs Sonnet based on doc complexity
│   ├── data/
│   │   ├── contracts.json       # All extracted contract data
│   │   ├── users.json           # Registered users (hashed passwords)
│   │   ├── chats.json           # Chat history per user
│   │   ├── folders.json         # Folder structure per user
│   │   └── stats.json           # Cumulative API cost and time-saved stats
│   └── contracts/               # Uploaded contract PDFs (temporary storage)
│
└── frontend/
    ├── index.html               # Main chat app shell
    ├── landing.html             # Auth page (login / register / guest)
    ├── package.json             # Vite + Chart.js dependencies
    └── src/
        ├── main.js              # All application logic (~800 lines)
        └── style.css            # Complete design system (~1600 lines)
```

---

## 5. Backend — File-by-File

---

### Entry Point & Configuration

#### `backend/main.py`

The FastAPI application entry point. Does three things:

1. **Adds `sys.path`** so that relative imports work correctly when running with `python main.py` or `uvicorn`.
2. **Registers all routers** — each route file (`documents`, `chat`, `chats`, `auth`, `analytics`, `folders`, `projects`) is imported and mounted onto the app with `app.include_router(...)`.
3. **Configures CORS** — allows all origins (`*`), all methods, all headers. This is intentional for development; in production you would restrict origins.
4. **Global exception handler** — catches any unhandled exception, prints the full traceback to the console, and returns a `500` JSON response with the error message and traceback. This makes debugging easy without crashing the server silently.

The `if __name__ == "__main__"` block starts `uvicorn` with hot-reload enabled.

---

#### `backend/config.py`

Single source of truth for all file paths and secrets. Uses `python-dotenv` to load a `.env` file at startup.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Loaded from `.env`, currently unused in routing (Regolo key is hardcoded in route files) |
| `ELEVENLABS_API_KEY` | Used by `services/elevenlabs.py` for voice synthesis |
| `ELEVENLABS_VOICE_ID` | Default voice ID for ElevenLabs (Rachel, English) |
| `PORT` | Uvicorn port, defaults to `8000` |
| `DATA_DIR` | Absolute path to `backend/data/` |
| `DATA_FILE` | `data/contracts.json` |
| `STATS_FILE` | `data/stats.json` |
| `USERS_FILE` | `data/users.json` |
| `CHATS_FILE` | `data/chats.json` |
| `FOLDERS_FILE` | `data/folders.json` |
| `UPLOADS_DIR` | `backend/contracts/` — where uploaded PDFs are temporarily written |

All paths are computed with `os.path.join` relative to `__file__`, so the app works correctly regardless of where it is run from.

---

### Data Models

#### `backend/models.py`

Pydantic models that validate the JSON body of every `POST` and `PATCH` request. FastAPI uses these automatically — if a field is missing or has the wrong type, it returns a `422 Unprocessable Entity` before your route function even runs.

| Model | Fields | Used by |
|---|---|---|
| `ChatRequest` | `query: str`, `has_new_file: bool = False` | `POST /api/chat` |
| `TTSRequest` | `text: str` | `POST /api/tts` |
| `CalendarRequest` | `title`, `date`, `description`, `end_date?` | `POST /api/calendar/schedule` |
| `RegisterRequest` | `email`, `password`, `company?` | `POST /api/auth/register` |
| `LoginRequest` | `email`, `password` | `POST /api/auth/login` |
| `SaveChatRequest` | `user_id`, `chat_id`, `title`, `messages: list` | `POST /api/chats/save` |
| `SaveFolderRequest` | `user_id`, `folder_id?`, `name` | `POST /api/folders/save` |
| `MoveChatRequest` | `chat_id`, `folder_id?` | `PATCH /api/folders/{user_id}/move` |

The `?` means the field is `Optional`. For example, `folder_id` in `MoveChatRequest` can be `null` to remove a chat from a folder.

---

### Routes (API Endpoints)

#### `backend/routes/documents.py`

Handles contract file uploads and the contract database.

**`_load_db()` / `_save_db()`** — helper functions that read/write `contracts.json`. If the file doesn't exist yet (first run), `_load_db()` returns a safe default structure with empty lists so that nothing crashes.

**`POST /api/upload`** — the most important endpoint in the whole app. The sequence is:

1. Save the uploaded file to a temporary path using Python's `tempfile`.
2. Call `services/parser.py` to extract raw text and count pages.
3. If the text is empty (scanned PDF, encrypted), return `400`.
4. Call `services/extractor.py` to send the text to the LLM and get back a structured contract JSON.
5. **Upsert logic** — before saving, check if a contract with the same `(product, start_date, end_date)` fingerprint already exists. If yes, replace it. If no, append it. This prevents duplicates when the same file is uploaded twice.
6. **Recompute aggregations from scratch** — recalculate `revenue_by_category`, `revenue_by_year`, and `total_revenue` by iterating over all contracts. This avoids accumulation bugs (where re-uploads would add to the total instead of replacing it).
7. Save `last_uploaded: {id, client}` in the DB — the chat route reads this to know which contract to focus on.
8. Track API cost and time-saved via `services/cost_tracker.py`.
9. Return the parsed contract data to the frontend.

**`GET /api/contracts`** — returns the full list of all contracts.

**`GET /api/contracts/{contract_id}`** — returns a single contract by its `id` field (e.g., `CTR-001`).

---

#### `backend/routes/chat.py`

Handles AI chat conversations and auxiliary features.

**`_client`** — an `openai.OpenAI` instance pointing to `https://api.regolo.ai/v1` with the Regolo API key. The OpenAI Python SDK is used as-is because Regolo is OpenAI-compatible.

**`_contracts_summary()`** — takes the full contract list and strips it down to only the fields the AI needs (id, client, value_annual, status, end_date, risk_score, clauses, notes). This reduces token usage significantly compared to sending the full JSON.

**`_clean_json()`** — strips markdown code fences (` ```json `) and removes any JavaScript function syntax (e.g., `"callbacks": function(ctx){...}`) that the LLM might accidentally include. This prevents `json.loads()` from crashing.

**`POST /api/chat`** — the main conversation endpoint:

1. Loads the contract DB.
2. If `has_new_file` is `True`, it filters the context to only the last uploaded contract (using `db["last_uploaded"]`). This is critical: without this, asking "what are the risks?" after an upload would analyze all 13 contracts instead of just the new one.
3. Builds the system prompt by calling `services/citation.py`.
4. Calls the LLM via the Regolo client.
5. Tries to parse the response as JSON. The AI is instructed to always return `{"text": "...", "chart_data": {...}}`. If parsing fails, wraps the raw text in the same structure.
6. Tracks cost and returns the result.

**`POST /api/tts`** — checks if ElevenLabs is configured, then calls `services/elevenlabs.py` and returns the audio as a base64 string. The frontend decodes and plays it via the Web Audio API.

**`POST /api/calendar/schedule`** — does not call any external API. Instead, it builds a Google Calendar URL in the format `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...`. When the frontend opens this URL in a new tab, Google Calendar opens with the event pre-filled.

---

#### `backend/routes/auth.py`

Simple token-based authentication stored in `users.json`.

**`_hash(password)`** — SHA-256 hash of the password. No salt. This is sufficient for a demo/hackathon; in production you would use `bcrypt` or `argon2`.

**`POST /api/auth/register`** — implements **upsert semantics**: if the email already exists, it updates the password and token rather than returning a `409 Conflict`. This design decision was intentional to avoid frustrating demo users who re-register with the same email.

**`POST /api/auth/login`** — validates email + password hash, regenerates a new UUID token on every login (session rotation), and returns the token along with `user_id`, `company`, and `email`.

**`GET /api/auth/verify`** — scans all users to find the one with a matching token. Used by the frontend to restore a session after page reload. Returns `401` if the token is not found.

---

#### `backend/routes/chats.py`

Persists per-user chat history so conversations survive page reloads and browser closes.

**Data structure in `chats.json`:**
```json
{
  "user-uuid-here": [
    {
      "id": "chat-uuid",
      "title": "First 48 chars of first message…",
      "messages": [
        {"role": "user", "content": "..."},
        {"role": "ai",   "content": "..."}
      ],
      "folder_id": "folder-uuid-or-absent"
    }
  ]
}
```

**`POST /api/chats/save`** — upserts a chat by `chat_id`. If the chat ID already exists in the list, it replaces it in-place (updating the message history). If not, it prepends it (newest first). Keeps a maximum of 50 chats per user to prevent unbounded growth.

**`GET /api/chats/{user_id}`** — returns all chats for a user, ordered newest-first.

**`DELETE /api/chats/{user_id}/{chat_id}`** — removes a specific chat from the user's list.

---

#### `backend/routes/analytics.py`

Read-only endpoints that summarize the contract portfolio.

**`GET /api/dashboard/overview`** — returns KPIs (total contracts, active contracts, total revenue) and the two revenue breakdowns (`revenue_by_year`, `revenue_by_category`) that are pre-computed and stored in `contracts.json`.

**`GET /api/analytics/portfolio`** — calls `services/risk_engine.py` for a deeper analysis: expiring contracts (within 60 days), high-risk contracts (score ≥ 7), anomalous discounts, top 5 clients by revenue, and clause frequency counts.

**`GET /api/stats`** — returns the cumulative usage statistics from `stats.json`: API cost in USD, total tokens used, estimated hours saved, and ROI in EUR.

---

#### `backend/routes/folders.py`

Manages the sidebar folder system for organizing chat history.

**Data structure in `folders.json`:**
```json
{
  "user-uuid-here": [
    {"id": "folder-uuid", "name": "Progetto Alpha"}
  ]
}
```

Folder membership is stored on the chat object itself (as `folder_id`) inside `chats.json`, not inside `folders.json`. This means deleting a folder requires two writes: removing it from `folders.json` and clearing `folder_id` from any affected chats in `chats.json`.

**`GET /api/folders/{user_id}`** — lists all folders for a user.

**`POST /api/folders/save`** — creates a new folder or renames an existing one. If `folder_id` is omitted in the request, a new UUID is generated.

**`DELETE /api/folders/{user_id}/{folder_id}`** — removes the folder and unassigns all chats that belonged to it (they become visible again in the main history).

**`PATCH /api/folders/{user_id}/move`** — sets or clears the `folder_id` field on a specific chat. Setting `folder_id: null` moves the chat back to the general history.

---

#### `backend/routes/projects.py`

A placeholder endpoint that returns a single hard-coded project ("Portfolio Principale"). It exists to keep the route namespace reserved for a future feature where contracts could be grouped into named projects with their own metadata.

---

### Services (Business Logic)

#### `backend/services/parser.py`

Extracts plain text from uploaded files. Has exactly two cases:

- **PDF** — uses `fitz` (PyMuPDF) to open the document, iterate over all pages, and concatenate their text. Returns text plus the actual page count.
- **DOCX/DOC** — uses `python-docx` to iterate over paragraphs and join them with newlines. Page count is estimated as `max(1, len(text) // 3000)` since DOCX files don't have a native page concept.

Any other file extension raises a `ValueError` which the route handler turns into a `400` response.

---

#### `backend/services/extractor.py`

The most complex service. Sends the raw contract text to the LLM and receives back a structured JSON object representing the contract.

**System prompt design** — the prompt is very specific about what to extract and how:

- `value_annual` — must be calculated from the explicit periodic fee (monthly × 12, quarterly × 4, annual as-is). The model is forbidden from dividing `total_value / duration_months` because that gives the wrong result for contracts with setup fees or variable portions.
- `clauses` — restricted to a precise vocabulary: `"SLA Penalty"`, `"Rinnovo Automatico"`, `"Sconto Anomalo"`, `"Recesso Vincolato"`, `"Data Retention Risk"`, `"Limitazione Responsabilità"`, `"Dati Vietati"`, `"Verifica Output AI"`. If a contract has no early-termination clause, the model must add a `"Recesso Vincolato"` clause with `risk_level: "high"`.
- The model is instructed to return **only valid JSON** with no markdown fences, no commentary.

After the LLM responds, the raw text is passed to `_clean_json()` to strip any accidental markdown or JS syntax before `json.loads()`.

---

#### `backend/services/citation.py`

Builds the system prompt for the **chat** endpoint (as opposed to the extraction prompt in `extractor.py`).

**`build_chat_system_prompt(contracts_json)`** — injects the current contract data directly into the prompt. Key instructions:

- Always respond in Italian.
- Always cite sources using the format `[Fonte: ClientName]` or `[Fonte: CTR-XXX — Clausola]` — the frontend renders these as highlighted spans.
- When the user asks for charts, include `chart_data` as a valid Chart.js v4 configuration object.
- Chart type guidance is specified in detail: horizontal bar for revenue (sorted high-to-low), doughnut for proportions, line for trends, vertical bar for risk scores. This prevents the model from always generating the same chart type.
- **Hard prohibition** on JavaScript callbacks in the chart config, because `JSON.parse()` cannot handle them and they would crash the chart renderer.

---

#### `backend/services/risk_engine.py`

Pure Python portfolio analysis — no LLM involved. Iterates over all contracts and computes:

- **Expiring soon** — contracts where `end_date` is within the next 60 days, sorted by days remaining.
- **High risk** — contracts with `risk_score >= 7`.
- **Anomalous discounts** — contracts where the extracted `discount_percent` exceeds `standard_discount` (defaults to 12% if not specified).
- **Revenue concentration** — top 5 clients by annual value and their combined percentage of total portfolio revenue. High concentration is a business risk indicator.
- **Clause frequency** — a dictionary counting how many times each clause type appears across all contracts.

---

#### `backend/services/cost_tracker.py`

Tracks cumulative API usage across all sessions and calculates ROI.

**Pricing table** — hardcoded token costs for Claude Haiku and Claude Sonnet (per 1K tokens). Since the app currently uses `qwen3-coder-next` via Regolo, the pricing falls back to the Sonnet rate for any unrecognized model name.

**`update_stats()`** — called after every upload and every chat message. Increments:
- `api_cost_usd` — cost based on token counts
- `total_tokens` — sum of input + output tokens
- `hours_saved` — estimated at **15 minutes per page** reviewed (based on the assumption that a human lawyer spends ~15 min reading and summarizing one contract page)

**`get_roi()`** — calculates net ROI: `(hours_saved × €35/hour) - api_cost_in_EUR`. The €35/hour is the assumed cost of a junior paralegal. This value is displayed in the settings modal in the UI.

---

#### `backend/services/elevenlabs.py`

Thin wrapper around the ElevenLabs REST API.

**`text_to_speech(text)`** — sends a POST request to `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with the model `eleven_multilingual_v2` (which handles Italian well). The text is truncated to 2,500 characters to stay within ElevenLabs free-tier limits. Returns raw MP3 bytes.

**`is_configured()`** — returns `True` only if `ELEVENLABS_API_KEY` is set in `.env` and doesn't start with `"your-"` (the placeholder value). The chat route checks this before calling TTS and returns a graceful `status: "missing_key"` response instead of crashing.

---

#### `backend/services/model_selector.py`

A lightweight heuristic to choose between two Claude models — though **currently unused** by the extractor, which hardcodes `qwen3-coder-next`.

The logic: if the document has more than 1,500 words OR contains any of a predefined set of complex legal terms (like `"penalty"`, `"indemnification"`, `"force majeure"`), use `claude-sonnet-4-6`. Otherwise use `claude-haiku-4-5-20251001` (cheaper and faster for simple documents).

---

### Data Files

#### `backend/data/contracts.json`

The main database. Top-level structure:
```json
{
  "company": "TechVenture Italia Srl",
  "extraction_date": "2026-...",
  "total_contracts": 13,
  "total_revenue": 3339360,
  "revenue_by_year": {"2024": 1200000, "2025": 2139360},
  "revenue_by_category": {"Software": 900000, "Services": 2439360},
  "last_uploaded": {"id": "CTR-001", "client": "Acme Corp"},
  "contracts": [ ...array of contract objects... ]
}
```

Each contract object contains: `id`, `client`, `product`, `category`, `status`, `value_annual`, `total_value`, `start_date`, `end_date`, `risk_score`, `discount_percent`, `standard_discount`, `auto_renewal`, `clauses`, `notes`.

#### `backend/data/users.json`

Keyed by lowercase email. Each entry: `{user_id, password_hash, company, token}`. The `token` is a UUID regenerated on each login.

#### `backend/data/chats.json`

Keyed by `user_id`. Each value is an array of chat objects sorted newest-first. Chat objects carry an optional `folder_id` field when they have been moved to a folder.

#### `backend/data/folders.json`

Keyed by `user_id`. Each value is an array of folder objects: `{id: uuid, name: string}`.

#### `backend/data/stats.json`

Flat object: `{total_tokens, api_cost_usd, hours_saved}`. All values are cumulative and never reset.

---

## 6. Frontend — File-by-File

---

#### `frontend/landing.html`

The authentication entry point. A standalone HTML page with all CSS inlined (no external stylesheet dependency) so it loads instantly.

**Structure:**
- Left side: marketing hero with feature list
- Right side: auth card with two tabs — `Accedi` (login) and `Registrati` (register)

**Auth flow:**
1. On page load, if `localStorage.cai_token` already exists, redirect immediately to `/` (already logged in).
2. `handleLogin()` / `handleRegister()` call the backend API, disable the button during the request, show inline error messages on failure.
3. On success, `saveAndRedirect()` writes `cai_token`, `cai_user_id`, `cai_company`, `cai_email` to `localStorage`, then redirects to `/`.
4. **Guest access** — the `guestLogin()` function bypasses the API entirely. It sets `cai_token: "guest"` and generates a random `user_id` client-side. The backend doesn't know about guest users; their chat history is saved locally via `chats.json` using the random ID.

---

#### `frontend/index.html`

The main application shell. Contains only the HTML structure — all behavior is in `main.js`.

**Key elements:**
- **`#sidebar`** — the left panel containing:
  - Logo + "Nuova Chat" button (reloads the page to start fresh)
  - `#folders-section` — empty div, populated entirely by `main.js` with the folder system
  - `#history-section` — contains the static "CRONOLOGIA CHAT" title; chat items are added by `main.js`
- **`#chat-stream`** — the scrollable message area. Contains the initial welcome message from the AI.
- **`.chat-input-area`** — the bottom input bar with: attach button, textarea, microphone button, send button.
- **`#settings-modal`** — hidden ROI statistics modal triggered by the gear icon.
- **Auth redirect script** — a tiny synchronous `<script>` block that runs before `main.js` loads. If `cai_token` is not in `localStorage`, it calls `window.location.replace('/landing.html')` immediately. This prevents the chat app from flashing on screen before the redirect.

---

#### `frontend/src/main.js`

The entire frontend application in one file (~800 lines). Organized into logical sections:

**Auth constants (top-level)**
```js
const _token   = localStorage.getItem('cai_token');
const _userId  = localStorage.getItem('cai_user_id');
const _company = localStorage.getItem('cai_company');
```
These are read once at module load time. If `_token` is absent, the page redirects to `/landing.html`.

**`state` object** — centralized mutable state:
- `chatHistory[]` — messages of the current chat session
- `attachedFile` — the `File` object currently attached (if any)
- `chartInstances[]` — Chart.js instances (kept to call `.destroy()` if needed)
- `lastUploadDone: bool` — `true` after a successful upload; makes the next message still use the uploaded contract as context even if no new file is attached (for the suggestion chips)
- `currentChatId` — UUID of the current chat session, initialized fresh on every page load
- `lastAiText` — the most recent AI response text (used as TTS input)
- `folders[]` / `openFolders` (Set) — folder data and expansion state
- `allChats[]` — the full chat list fetched from the backend, used to render both folders and history

**`initChatUI()`** — attaches event listeners to the send button, Enter key, textarea auto-resize, file attachment input, and pre-existing suggestion chips.

**`handleSend()`** — the core user interaction function:
1. If a file is attached, POST it to `/api/upload` first.
2. Build the chat request with `has_new_file: state.lastUploadDone`.
3. If this is not an upload, reset `state.lastUploadDone` to `false` so future messages don't keep the file context.
4. Append a loading bubble while waiting for the AI.
5. On response, call `appendMessage()` with the AI text and optional chart data.
6. If this was an upload, call `appendPostUploadSuggestions()` to show the three analysis chips.
7. Push the exchange to `state.chatHistory` and call `saveCurrentChat()`.

**`appendMessage(role, text, filename, chartData)`** — builds the message HTML:
- Formats text: escapes HTML, converts `\n` to `<br>`, wraps `[Fonte: ...]` in highlighted `<span class="chat-citation">` elements, applies `**bold**` markdown.
- For AI messages: adds "Ascolta Sintesi" (TTS) and "Aggiungi a Google Calendar" action buttons with their full event listeners inline.
- If `chartData` is present, creates a `<canvas>` element and calls `renderInChatChart()` after the message is in the DOM.

**`renderInChatChart(canvasId, chartConfig)`** — Chart.js renderer with significant post-processing:
- Detects if values represent money (any value > 1,000) and formats them as `€780k` / `€1.5M`.
- Applies a 15-color palette consistently.
- For horizontal bar charts: sets the canvas container height to `36px × labelCount` for readability.
- Overrides tooltip callbacks to show euro formatting and percentages for pie/doughnut charts.
- Strips any `callbacks` keys or JavaScript functions that the LLM might have included (three-layer safety: backend regex, prompt instruction, and this client-side strip).

**`loadSidebar()` / `renderFolders()` / `renderChatHistory()`** — the sidebar rendering pipeline:
1. `loadSidebar()` fetches both `/api/chats/{userId}` and `/api/folders/{userId}` in parallel, stores results in `state.allChats` and `state.folders`, then calls both render functions.
2. `renderFolders()` builds the "CARTELLE" section: a header row with "+" button, then one `.folder-item` per folder with a toggle arrow, folder icon, name, chat count badge, and delete button. Each folder header is a drag-drop target.
3. `renderChatHistory()` filters `state.allChats` to only those without a `folder_id` and renders them in the history section.

**`buildChatNavItem(chat, folderId)`** — creates a single nav button for a chat. Chats outside folders get `draggable="true"` and a `dragstart` handler that stores the chat ID in the drag event's data transfer. All chat items get a three-dot `⋮` button that shows a context menu on click.

**`showChatContextMenu(e, chat, currentFolderId)`** — builds and positions a floating dropdown menu:
- If the chat is inside a folder: shows "↩ Rimuovi dalla cartella"
- Shows "Sposta in cartella →" with one button per existing folder
- If no folders exist: shows "+ Crea prima una cartella" which calls `createFolder(chat.id)` to immediately create and move in one step

**`createFolder()` / `deleteFolder()` / `moveChat()`** — async functions that call the backend and then re-fetch the full sidebar data. `createFolder()` optionally receives a `chatId` to auto-move into the new folder after creation.

**`saveCurrentChat(firstUserText)`** — called after every AI response. Uses the first 48 characters of the first user message as the chat title. Calls the legacy `loadChatHistory()` alias which triggers a full sidebar refresh.

**`initUserUI()`** — sets the company name in the topbar badge and injects a logout button that clears all four `localStorage` keys and redirects to `/landing.html`.

---

#### `frontend/src/style.css`

~1,600 lines organized into clear sections:

| Section | What it covers |
|---|---|
| CSS Custom Properties | Dark enterprise color palette (zinc/slate), accent blue, status colors (green, red, orange), shadows, border radii, sidebar width |
| Reset & Base | `box-sizing`, `html` font size (14px base), body overflow hidden |
| Scrollbar | Custom thin scrollbar matching the dark theme |
| Sidebar | Fixed-width sidebar, sidebar header with logo |
| Nav Items | `.nav-item`, `.nav-text`, active/hover states |
| Topbar | 56px fixed header with title, company badge, action icons |
| Chat Stream | The scrollable message container |
| Chat Messages | `.chat-message.ai` / `.chat-message.user`, avatars, content bubbles |
| Chat Input | Bottom input area with textarea auto-grow, attach/mic/send buttons |
| Chart Cards | `.chat-chart-card` with `min-height: 220px; position: relative` so Chart.js canvas can fill it dynamically |
| Suggestion Chips | Post-upload action chips styling |
| Toast Notifications | Slide-in toast container |
| Modals | Settings/ROI modal overlay |
| Folder System (new) | `.nav-group`, `.nav-group-title`, `.folder-item`, `.folder-header`, `.folder-header.drag-over`, `.folder-toggle`, `.folder-chats`, `.chat-menu-btn`, `.folder-context-menu` — full styling for the folder drag-and-drop UI |
| Responsive | Mobile breakpoints that collapse sidebar and adjust typography |

---

## 7. Key Data Flows

### Upload Flow

```
User selects file
      │
      ▼
frontend: POST /api/upload (multipart/form-data)
      │
      ▼
backend/routes/documents.py
  1. Save to tempfile
  2. parser.py → extract text + page count
  3. extractor.py → LLM call → contract JSON
  4. Upsert into contracts.json (match by product+dates)
  5. Recompute all aggregations from scratch
  6. Store last_uploaded {id, client}
  7. cost_tracker.update_stats(cost, tokens, pages)
      │
      ▼
frontend receives parsed_data
  state.lastUploadDone = true
  appendPostUploadSuggestions()  ← 3 analysis chips appear
```

### Chat Flow (after upload)

```
User clicks chip or types a question
      │
      ▼
frontend: POST /api/chat  {query, has_new_file: true}
      │
      ▼
backend/routes/chat.py
  1. Load contracts.json
  2. has_new_file=true → filter to last_uploaded contract only
  3. citation.py → build system prompt with slim contract JSON
  4. Regolo AI (qwen3-coder-next) → {text, chart_data}
  5. _clean_json() → strip markdown, strip JS functions
  6. json.loads() → result dict
  7. cost_tracker.update_stats()
  8. Return result
      │
      ▼
frontend
  appendMessage('ai', data.text, null, data.chart_data)
  renderInChatChart()   ← if chart_data present
  state.lastUploadDone = false  ← reset for next message
  saveCurrentChat()     ← persist to chats.json
```

---

## 8. Setup & Running Locally

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Regolo AI account (or replace the hardcoded key)

### Backend

```bash
cd CODEMOTION/backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate          # Linux/macOS
# venv\Scripts\activate           # Windows

# Install dependencies
pip install fastapi uvicorn python-dotenv openai pymupdf python-docx requests pydantic

# Copy the example env file and fill in your keys
cp .env.example .env

# Start the server (with hot-reload)
python main.py
# → Running on http://localhost:8000
# → API docs at http://localhost:8000/docs
```

### Frontend

```bash
cd CODEMOTION/frontend

npm install

npm run dev
# → Running on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## 9. Environment Variables

Create `backend/.env` with the following:

```env
# Required for TTS voice synthesis
ELEVENLABS_API_KEY=your-elevenlabs-key-here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # Rachel (default)

# Optional — referenced in config.py but not currently used by routing
ANTHROPIC_API_KEY=your-anthropic-key-here

# Server port (default: 8000)
PORT=8000
```

> **Note:** The Regolo AI key (`sk-Ku2I6c...`) is currently hardcoded in `routes/chat.py` and `services/extractor.py`. For production, move it to `.env` as `REGOLO_API_KEY`.

---

## 10. Full API Reference

### Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{email, password, company?}` | `{token, user_id, company, email}` |
| `POST` | `/api/auth/login` | `{email, password}` | `{token, user_id, company, email}` |
| `GET` | `/api/auth/verify` | `?token=...` | `{valid, user_id, company, email}` |

### Documents

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/upload` | `multipart: file` | `{filename, status, parsed_data, model_used, pages}` |
| `GET` | `/api/contracts` | — | `{contracts: [...]}` |
| `GET` | `/api/contracts/{id}` | — | Contract object |

### Chat

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/chat` | `{query, has_new_file}` | `{text, chart_data}` |
| `POST` | `/api/tts` | `{text}` | `{status, audio_base64}` |
| `POST` | `/api/calendar/schedule` | `{title, date, description, end_date?}` | `{status, event_link}` |

### Chat History

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/chats/save` | `{user_id, chat_id, title, messages}` | `{status}` |
| `GET` | `/api/chats/{user_id}` | — | `{chats: [...]}` |
| `DELETE` | `/api/chats/{user_id}/{chat_id}` | — | `{status}` |

### Folders

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/folders/{user_id}` | — | `{folders: [...]}` |
| `POST` | `/api/folders/save` | `{user_id, folder_id?, name}` | `{status, folder_id, folders}` |
| `DELETE` | `/api/folders/{user_id}/{folder_id}` | — | `{status}` |
| `PATCH` | `/api/folders/{user_id}/move` | `{chat_id, folder_id?}` | `{status}` |

### Analytics

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/dashboard/overview` | KPIs, revenue by year and category |
| `GET` | `/api/analytics/portfolio` | Expiring contracts, high risk, anomalous discounts, top clients |
| `GET` | `/api/stats` | API cost, tokens used, hours saved, ROI in EUR |

---

*Built with FastAPI · Regolo AI · Chart.js · Vite · ElevenLabs*
