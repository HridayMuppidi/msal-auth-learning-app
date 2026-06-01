# MSAL Auth Learning App

A learning project built to understand enterprise authentication and authorisation using Microsoft Authentication Library (MSAL) and Azure Active Directory (Azure AD).

Built by **Hriday Muppidi** as part of mentorship training under **Qual Labs**.

---

## What This Project Covers

This project demonstrates the full OAuth 2.0 and OpenID Connect authentication flow in a real enterprise context. It covers:

- **Authentication** — verifying user identity through Azure AD using MSAL
- **Authorisation** — protecting API endpoints using JWT token validation middleware
- **Bidirectional middleware** — validating both incoming requests and outgoing responses
- **Token inspection** — understanding what is inside access tokens and ID tokens

---

## Project Structure

```
msal-auth-learning-app/
├── msal-login-app/        # React frontend — handles login and weather UI
│   ├── src/
│   │   ├── components/    # Login, Home, Weather, Testing Panel
│   │   ├── authConfig.js  # MSAL configuration
│   │   └── App.jsx
│   ├── .env               # Client ID and Tenant ID (not committed)
│   └── package.json
│
└── server/                # FastAPI backend — middleware and weather API
    ├── main.py            # FastAPI app entry point
    ├── middleware.py      # JWT validation middleware
    ├── .env               # Azure AD config (not committed)
    └── requirements.txt
```

---

## How It Works

```
User clicks Login
  → MSAL redirects to Azure AD
    → User enters Microsoft credentials
      → Azure AD issues JWT tokens (access + ID + refresh)
        → React app stores tokens
          → User requests weather data
            → React attaches JWT token to request header
              → FastAPI middleware validates token
                → Valid: weather data returned
                → Invalid: 401 Unauthorized
```

---

## Prerequisites

Make sure you have these installed before getting started:

- **Node.js** v18 or above — https://nodejs.org
- **Python** 3.10 or above — https://python.org
- **Git** — https://git-scm.com
- An **Azure AD App Registration** with:
  - A redirect URI set to `http://localhost:3001`
  - A scope exposed under Expose an API (e.g. `Weather.Read`)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/HridayMuppidi/msal-auth-learning-app.git
cd msal-auth-learning-app
```

---

### 2. Set up the Frontend

```bash
cd msal-login-app
npm install
```

Create a `.env` file inside `msal-login-app/`:

```
VITE_CLIENT_ID=your-azure-client-id
VITE_TENANT_ID=your-azure-tenant-id
VITE_REDIRECT_URI=http://localhost:3001
```

Start the frontend:

```bash
npm run dev
```

The React app will be running at **http://localhost:3001**

---

### 3. Set up the Backend *(optional — frontend works standalone)*

```bash
cd ../server
pip install -r requirements.txt
```

Create a `.env` file inside `server/`:

```
CLIENT_ID=your-azure-client-id
TENANT_ID=your-azure-tenant-id
JWKS_URI=https://login.microsoftonline.com/{your-tenant-id}/discovery/v2.0/keys
FRONTEND_URL=http://localhost:3001
```

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

The FastAPI server will be running at **http://localhost:8000**

> **Note:** The backend server is optional for the initial login flow. You only need it if you want to test the middleware and the weather tab.

---

## Testing the Middleware

Once both servers are running, the Weather tab in the app includes a **Testing Panel** that lets you simulate different request scenarios:

| Test | What it sends | Expected result |
|---|---|---|
| Valid Request | Real JWT token | 200 — weather data |
| No Token | No Authorization header | 401 Unauthorized |
| Fake Token | Random string as token | 401 Signature failed |
| Tampered Token | Real token with modified characters | 401 Signature failed |
| Wrong Audience | Graph token instead of API token | 401 Wrong audience |

You can also test using **Thunder Client** in VS Code or **Postman**:

```
GET http://localhost:8000/weather?zipcode=95630
Authorization: Bearer {paste your token here}
```

---

## Key Concepts Learned

**Authentication vs Authorisation**
Authentication verifies who you are. Authorisation controls what you can access. Authentication happens at login via Azure AD. Authorisation happens on every API request via the middleware.

**JWT Tokens**
JSON Web Tokens carry identity information in three parts — header, payload, and signature. The signature is verified against Azure AD's public keys fetched from the JWKS endpoint.

**MSAL**
Microsoft Authentication Library handles the full OAuth 2.0 redirect flow in the React app — login, token storage, token refresh, and logout.

**Middleware**
The FastAPI middleware intercepts every request before it reaches an endpoint and validates the JWT token. It also validates responses coming back from the external weather API before passing them to the client.

**PKCE**
Proof Key for Code Exchange adds two extra parameters to the OAuth flow to prevent authorisation code interception attacks without relying on a client secret stored in the browser.

---

## Environment Variables

Never commit `.env` files to GitHub. Both `.env` files are listed in `.gitignore`. Ask the project maintainer for the Client ID and Tenant ID values.

---

## Author

**Hriday Muppidi**
- GitHub: [github.com/HridayMuppidi](https://github.com/HridayMuppidi)
- LinkedIn: [linkedin.com/in/hriday-muppidi](https://linkedin.com/in/hriday-muppidi)
- Portfolio: [datascienceportfol.io/hridaymuppidi](https://datascienceportfol.io/hridaymuppidi)

---

## Acknowledgements

Built under the mentorship of **Qual Labs** as part of a structured enterprise development training programme.

---

*This is a learning project. Not intended for production use.*
