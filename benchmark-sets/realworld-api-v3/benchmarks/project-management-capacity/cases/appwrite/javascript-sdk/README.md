# Appwrite project-management capacity

This case runs the authenticated project-management workload through Appwrite's official JavaScript `Account` and `TablesDB` SDKs on Node.js 22 or newer. Administrative provisioning and deterministic fixture loading use the server SDK outside measurement; each virtual user receives an isolated client and Account session.

TablesDB rows are tenant-filtered by organization/project/task fields and returned through the shared normalized contract. Email/password sessions, refresh, sign-out, profile updates, pagination, search, and mutations are measured through the SDK. SDK calls that lack native abort options are bounded by the adapter timeout and invalidate unresolved requests.

Appwrite's TablesDB row/permission model and native Account service are the case's declared access path; schema setup and permission configuration remain outside measured operations.
