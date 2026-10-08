# Publishing the extension on the Chrome Web Store

1. Dev Resolve → **Admin → Files & extension → Download package for the Web Store** (built for this deployment).
2. https://chrome.google.com/webstore/devconsole → sign in with your **work** Google account → pay the one-time
   developer fee → **New item** → upload the zip.
3. Fill the listing with the text below. **Visibility: Private** ("only users in my Google Workspace domain") — or
   **Unlisted** if the developer account isn't in your Workspace. Submit for review (usually 1–3 days).
4. When it's published, paste its store link in **Admin → Files & extension → Chrome Web Store link** → Save.
   The Connector page then shows **Add to Chrome**.
5. New version (developers): bump `EXTENSION_VERSION` in `src/lib/extensionPackage.ts`, deploy, download the package again, upload it under the same item.
   Installed copies update automatically.

## Store listing

**Name:** Dev Resolve connector
**Summary (132 chars):** Connects Dev Resolve to systems your laptop can reach on the company VPN and to your own sign-ins, for ticket investigations.
**Category:** Developer Tools · **Language:** English
**Description:**
> For people using their company's Dev Resolve (support-ticket investigations). While Chrome is open, the extension lets
> Dev Resolve reach internal systems that only your laptop can reach on the company VPN, for investigations you start,
> and keeps your own sign-ins to Google-login internal tools available to Dev Resolve so it works with your access.
> It talks only to the hosts listed in its manifest, makes only read requests on Dev Resolve's behalf, and has no
> analytics or ads. Install it, open Dev Resolve's Connector page, and it links itself to your account.

**Icon:** `icons/128.png` from the zip. **Screenshot (1280×800):** a screenshot of the Connector page showing "installed · linked to you".
**Privacy policy URL:** `https://<frontend>/privacy`

## Privacy practices tab

**Single purpose:** Let the company's Dev Resolve investigation tool reach internal systems through the user's laptop
(company VPN) and use the user's own sign-ins to internal tools.

**Permission justifications:**
- `storage` — keeps the token that links the extension to the user's Dev Resolve account, and its settings.
- `alarms` — wakes the extension every minute so it stays connected to Dev Resolve while Chrome is open.
- `cookies` — reads the session cookie of the listed Google-login internal tools (only those hosts) after the user signs
  in, so Dev Resolve uses the user's own access.
- `tabs` — opens the sign-in page of an internal tool when the user asks, and closes it when sign-in completes.
- Host permissions — the company's Dev Resolve frontend/backend, the company VPN-only hosts it relays read requests to
  (including the company's Claude gateway when it is VPN-only), and the sign-in hosts of the internal tools. No other sites.
- Remote code: **No** (all code is in the package).

**Data usage:** collects "Authentication information" (session cookies of the listed internal tools) and "Website
content" (responses from the listed internal hosts), only to provide the feature, sent only to the company's own Dev
Resolve server. Not sold, not used for anything else. Check the three certification boxes.
