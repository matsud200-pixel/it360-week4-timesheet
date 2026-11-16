# Week 4 Labs: Build, Containerize, Deploy and Secure the Nurse Timesheet (Use Cases 4.3, 4.4, 4.5, Timpanogos Home Health)

Three Canvas assignments, one client, one repository, the same four roles all week:

| Canvas | Lab | Points |
|---|---|---|
| 4.3 | Team Lab 1: Building and Containerizing a Full-Stack Timesheet Application | 40 |
| 4.4 | Team Lab 2: Deploying the Timesheet App to Kubernetes with Secure Architecture | 40 |
| 4.5 | Team Lab 3: Securing Kubernetes Application with Google Identity-Aware Proxy (IAP) | 40 |

Timpanogos Home Health employs 35 visiting nurses who log hours per patient visit. Hours
are texted to a scheduler who retypes them into payroll; a 2025 audit found a 4 percent error
rate. Visit records name patients, so the data falls under HIPAA. The agency wants a web
timesheet nurses use on their phones, hosted in the cloud, reachable only by staff with
agency Google accounts.

> **Where to run it.** Lab 4.3 runs on any laptop with Docker Desktop. Labs 4.4 and 4.5 need
> a GKE cluster: students use the **Vocareum Google Cloud lab** (free). Lab 4.5 also needs an
> OAuth consent screen, which is a console step in the same project. Anyone with a personal
> project can run the scripts in `scripts/` instead; they take the project ID as the argument.

Roles: backend developer (API, its Dockerfile, backend manifests), frontend developer (React
UI, its Dockerfile, frontend manifests), platform engineer (cluster, images, HTTPS load
balancer), compliance lead (IAM roles, IAP, access logs, the compliance paragraph).

**Student guides (start here):** one step-by-step guide per lab, in this folder as PDF and Word, all run end to end on November 15, 2026:

| Day | Canvas | Guide | Where you run it |
|---|---|---|---|
| Day 1 (Tuesday) | 4.3 | `Week 4 Lab 1 Student Guide - Build and Containerize the Timesheet App` | Your laptop (Terminal or PowerShell, Docker Desktop) |
| Day 2 (Thursday) | 4.4 | `Week 4 Lab 2 Student Guide - Deploy the Timesheet to GKE with a Private Backend` | Cloud Shell |
| Day 2 (Thursday) | 4.5 | `Week 4 Lab 3 Student Guide - Secure the Timesheet with Identity-Aware Proxy` | Cloud Shell and the Google Cloud console |

Each guide has the lab objectives, the technologies and why they matter for cloud integration, an orange **Run in** line on every command block, what each step does, and the real output to compare with.

## What is in this folder

```
backend/      Express API: /api/health, GET and POST /api/timesheet (nurse, patient CODE, date, hours)
frontend/     Vite + React UI; nginx.conf proxies /api to a host named "backend"
k8s/          backend.yaml (ClusterIP), frontend.yaml (LoadBalancer + NEG), iap.yaml (BackendConfig, cert, Ingress)
scripts/      deploy-lab4-1.sh / rollback-lab4-1.sh   (4.3, local Docker)
              deploy-lab4-2.sh / rollback-lab4-2.sh   (4.4, registry + GKE)
              deploy-lab4-3.sh / rollback-lab4-3.sh   (4.5, IAP)
```

Two updates to the Canvas guide: Vite replaces create-react-app (retired in 2025), and the
frontend calls the API by a relative path `/api` so the same image runs unchanged in Docker
and in Kubernetes.

---

## Lab 4.3: build and containerize (about 2 hours)

**Constraint.** The scheduler must be able to start the whole system on any laptop with two
`docker run` commands and nothing else installed.

### Part 1. Backend (backend developer, 30 min)

`backend/index.js` stores entries with a **patient code, never a name**. Run it:

```bash
cd backend && npm install && node index.js
# second terminal
curl -s -X POST localhost:5000/api/timesheet -H 'Content-Type: application/json' \
  -d '{"nurseName":"R. Alder","patientCode":"P-1042","visitDate":"2026-11-10","hours":1.5}'
curl -s localhost:5000/api/timesheet
```

On a Mac, AirPlay Receiver already listens on 5000: run `PORT=5001 node index.js`, use
`localhost:5001` in the two curl lines, and start Vite in Part 2 with
`API=http://localhost:5001 npm run dev`, or turn AirPlay
Receiver off in System Settings → General → AirDrop & Handoff.

**Validation 1.** The POST returns `{"saved":1}` and the GET lists it.
**Checkpoint.** Why a patient code and not a name? HIPAA: the timesheet needs to bill a
visit, not identify a patient; minimum necessary data.

### Part 2. Frontend (frontend developer, 40 min)

```bash
cd frontend && npm install && npm run dev
```

On a Mac with the backend on 5001 run `API=http://localhost:5001 npm run dev` instead (the Vite
proxy reads the `API` variable). Open http://localhost:3000 and submit three visits.
**Validation 2.** The list shows three entries. Screenshot 1.

### Part 3. Containers (platform engineer, 40 min)

```bash
docker network create timesheet
docker build -t timesheet-backend:1.0 ./backend
docker build -t timesheet-frontend:1.0 ./frontend
docker run -d --name backend  --network timesheet -p 5000:5000 timesheet-backend:1.0
docker run -d --name frontend --network timesheet -p 3000:3000 timesheet-frontend:1.0
docker ps
```

On a Mac, port 5000 is taken by AirPlay Receiver; use `-p 5001:5000` for the backend (the
frontend reaches it over the Docker network by name, so the host port does not matter).

**Validation 3.** `docker ps` shows both containers Up. Screenshot 2. Open
http://localhost:3000, submit a visit; it appears in the list. Screenshot 3.
**Checkpoint.** `docker stop backend`, reload: the page must say *Backend unreachable*
within a few seconds, not hang (`nginx.conf` sets a 2-second connect timeout; on 2026-10-31
`curl -m 5` through port 3000 returned 504 after 2.0 s).
`docker start backend`.

### Part 4. Repository (platform engineer, 10 min)

Push the project to GitHub with a README containing the `network create`, the two
`docker build` and the two `docker run` commands (the images exist only on the laptop that
built them until Lab 4.4 pushes them). A teammate clones on a second laptop and runs only
those commands.
**Validation 4.** Their terminal shows both containers up. Screenshot 4.

**Deliverable 4.3.** Screenshots 1 to 4 and the GitHub link.
**Cleanup.** `docker rm -f backend frontend && docker network rm timesheet`, or
`bash scripts/rollback-lab4-1.sh -y`. Nothing cloud-side yet.

---

## Lab 4.4: deploy to Kubernetes (90 min)

**Constraint.** Only the frontend may have a public address. The backend must be reachable
from the frontend pods and from nowhere else.

### Part 1. Publish the images (platform engineer, 10 min)

Docker Hub (students): `docker login -u <user>` with an access token, tag the two images
`<user>/timesheet-backend:1.0` and `<user>/timesheet-frontend:1.0`, push both. The script
uses Artifact Registry in the project instead (`<region>-docker.pkg.dev/<project>/timesheet`),
which needs no extra account; set `REGISTRY=<dockerhub user>` to use Docker Hub.

Build for the cluster's CPU type: on an Apple Silicon Mac add `--platform linux/amd64`.

### Part 2. Manifests (both developers, 20 min)

`k8s/backend.yaml`: Deployment with a readiness probe on `/api/health`, Service **ClusterIP**
named `backend` (the nginx proxy in the frontend image resolves that name exactly as it did
in Docker). `k8s/frontend.yaml`: Deployment with 2 replicas, Service **LoadBalancer** on
port 80 to 3000, annotated with a NEG so Lab 4.5 can put an HTTPS balancer in front without
redeploying. Replace `IMAGE_BACKEND` and `IMAGE_FRONTEND` with your image names.

**Checkpoint.** Point to the line that keeps the backend private: `type: ClusterIP`.

### Part 3. Cluster (platform engineer, 15 min)

```bash
gcloud container clusters create timpanogos --num-nodes=1 --zone=us-central1-a --machine-type=e2-medium \
  --disk-type=pd-standard --disk-size=50
gcloud container clusters get-credentials timpanogos --zone=us-central1-a
kubectl get nodes
```

The standard 50 GB disk avoids `Quota 'SSD_TOTAL_GB' exceeded` (the default is a 100 GB SSD-backed
disk; this failed on 2026-11-15 in a project already running two Autopilot clusters).

(AKS alternative in the Canvas guide: `az aks create -g timpanogos-rg -n timpanogos --node-count 1 --generate-ssh-keys`.
Lab 4.5 needs GKE, so choose GKE if the team does all three.)

### Part 4. Deploy and validate (whole team, 20 min)

```bash
kubectl apply -f k8s/backend.yaml -f k8s/frontend.yaml
kubectl get deployments; kubectl get pods; kubectl get services
```

**Validation 1 to 3.** The three outputs, with `frontend` showing an EXTERNAL-IP (repeat
after a minute if `<pending>`). Screenshots 1 to 3.
**Validation 4.** Open `http://<EXTERNAL-IP>` on a phone and submit a visit. Screenshot 4.
**Validation 5.** `http://<EXTERNAL-IP>:5000/api/timesheet` from the phone fails; from inside
the cluster it works:
`kubectl run probe --rm -it --image=busybox:1.36 --restart=Never -- wget -qO- http://backend:5000/api/timesheet`.
**Checkpoint.** `kubectl scale deployment frontend --replicas=3`; the external IP does not
change. Commit `k8s/` and push.

**Deliverable 4.4.** Screenshots 1 to 4, the GitHub link with `k8s/`, the external IP.
**Cleanup.** Keep the cluster if 4.5 is next; otherwise `kubectl delete -f k8s/` and delete
the cluster, or `bash scripts/rollback-lab4-2.sh <PROJECT_ID>` (`--keep-cluster` keeps it).
One e2-medium node plus the control plane bills about 100 dollars a month if left running.

---

## Lab 4.5: staff-only access with Identity-Aware Proxy (1 to 2 hours)

**Constraint.** A nurse who left last month must be refused at the login screen, and the
compliance lead must be able to show the auditor the log entry for that refusal. Access is
granted by IAM role, never by editing the app.

### Part 1. Services (platform engineer, 5 min)

```bash
gcloud services enable iap.googleapis.com compute.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com
```

Also turn on **Data Access audit logs for IAP** (IAM & Admin → Audit Logs → Identity-Aware Proxy
→ tick Admin Read, Data Read, Data Write → Save): IAP writes one log entry per allow or deny
decision only when they are on, and Part 5 reads those entries. The script does this for you.

### Part 2. OAuth consent and client (compliance lead, 15 min, console)

Console → Google Auth Platform → Overview → **Get started**: App Information (app name
*Timpanogos Timesheet*, your support email) → Audience **External** → Contact Information →
Finish (tick the agreement) → Create; then Audience → Test users: each teammate's Google
account, including the one that will be refused in Part 5.
Clients → Create client → Web application, name `timesheet-iap`. Copy the Client ID and
secret. Edit the client and add the redirect URI
`https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect`.

```bash
kubectl create secret generic iap-oauth --from-literal=client_id=<CLIENT_ID> --from-literal=client_secret=<CLIENT_SECRET>
```

Re-running this fails with `AlreadyExists`: `kubectl delete secret iap-oauth` first, or use the
script's idempotent form, `kubectl create secret generic iap-oauth ... --dry-run=client -o yaml | kubectl apply -f -`.

(The consent screen is a console-only step for projects outside an organisation, which is
why the script takes `CLIENT_ID` and `CLIENT_SECRET` as inputs.)

### Part 3. HTTPS load balancer with IAP (platform engineer, 30 min)

```bash
gcloud compute addresses create timesheet-ip --global
gcloud compute addresses describe timesheet-ip --global --format='value(address)'
```

Your hostname is the IP with dots replaced by dashes plus `.nip.io`, for example
`34-120-5-9.nip.io`; nip.io resolves it to the IP so a Google-managed certificate can be
issued. Put it in both `HOSTNAME` places of `k8s/iap.yaml`, then:

```bash
kubectl annotate --overwrite service frontend cloud.google.com/backend-config='{"default": "iap-config"}'
kubectl apply -f k8s/iap.yaml
kubectl get ingress timesheet-ingress
kubectl get managedcertificate timesheet-cert
```

The certificate shows *Provisioning* for 15 to 30 minutes, then *Active*.

Once `https://<HOSTNAME>` serves through IAP, remove the public HTTP path from Lab 4.4:

```bash
kubectl patch service frontend -p '{"spec":{"type":"ClusterIP"}}'
kubectl get svc frontend        # no EXTERNAL-IP any more
```

Without this, `http://<EXTERNAL-IP>` keeps serving the whole app with no sign-in while IAP
guards only the hostname. The NEG-backed Ingress keeps working with a ClusterIP Service.

### Part 4. Grant access by role, never by code (compliance lead, 10 min)

Console → Security → Identity-Aware Proxy. The backend service for `frontend` appears with
IAP on. Select it → Add principal → each teammate's account → role **IAP-secured Web App
User**. Screenshot 1: the panel with the principals.

### Part 5. Test both ways and read the log (whole team, 20 min)

**Validation 1.** `https://<HOSTNAME>` in a private window shows the Google sign-in before
any app content. Screenshot 2.
**Validation 2.** A granted account sees the timesheet; a personal account that **is on the
Test users list but was not granted the IAP role** sees IAP's *You don't have access*. An
account that is not a test user is stopped earlier by Google's *access blocked* page (the app
is in Testing), which is not the IAP refusal. Screenshot 3.
**Checkpoint.** Remove one teammate's role; they are refused within a minute. No pod was
restarted and no code changed. Use a teammate who is not a project Owner or Editor: the basic
Owner and Editor roles carry IAP access on every backend in the project (the IAP panel lists
*Owner (Legacy)* and *Editor (Legacy)* beside *IAP-secured Web App User*), so the project
owner is never refused.
**Validation 3.**

```bash
gcloud logging read 'protoPayload.methodName="AuthorizeUser"' --limit=20 \
  --format='table(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.status.message)'
```

A granted event and the denied event side by side. Screenshot 4. On the 2026-11-15 run IAP logged its
decisions with resource type `gce_backend_service`, so the older filter `resource.type="iap_web"`
returned nothing; filter on the method name as above. Unsigned requests appear as `Permission Denied.`
with no principal.

Compliance paragraph: map to HIPAA 164.312(a)(1) access control and 164.312(b) audit
controls. IAP enforces identity before any patient-coded data is served, access is granted
per person through IAM, and every attempt is logged with principal and outcome.

**Deliverable 4.5.** Screenshots 1 to 4 and the paragraph.
**Cleanup.** `kubectl delete -f k8s/iap.yaml`, release the static IP, delete the cluster (the
frontend Service, now ClusterIP, goes with `kubectl delete -f k8s/` or the cluster); or
`bash scripts/rollback-lab4-3.sh <PROJECT_ID>` then `rollback-lab4-2.sh`. The global HTTPS
load balancer bills about 18 dollars a month plus the cluster.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Frontend says *Backend unreachable* in Docker | Containers not on the same network, or the backend container is not named `backend` | Recreate with `--network timesheet --name backend` |
| `npm ci` fails | No lock file | `npm install` once, commit `package-lock.json` |
| Port 3000 or 5000 in use, or `node index.js` fails on 5000 | Vite dev server or AirPlay Receiver (Mac) | Stop Vite; Parts 1 and 2: `PORT=5001 node index.js`, curl 5001, Vite proxy to 5001 (or turn AirPlay Receiver off); Part 3: `-p 5001:5000` |
| Pods `ImagePullBackOff` | Image name typo, private repo, or wrong CPU architecture | Make it public, fix the name, build with `--platform linux/amd64` |
| Frontend pods restart a few times at start (three on 2026-10-31) | nginx resolves `backend` when it starts and exits until the backend Service exists; `kubectl logs <pod> --previous` ends with `host not found in upstream "backend"` | Harmless; once the Service name resolves nginx stays up |
| EXTERNAL-IP pending > 3 min | Regional external IP quota | Delete an unused forwarding rule |
| 502 after sign-in | Health check failing | `kubectl get svc frontend -o jsonpath='{.spec.ports[0].targetPort}'` must print `3000` |
| Sign-in loops | Redirect URI has the wrong client ID | Fix it on the OAuth client |
| Certificate `FailedNotVisible` | Hostname does not resolve to the static IP | Recheck the nip.io spelling |
| Test user gets *app not verified* | Not on the consent screen's test-user list | Add them |

## Stretch for the week

Add the Week 3 NetworkPolicy so the backend accepts traffic only from frontend pods, then
show both layers to the client: IAP at the edge, NetworkPolicy inside the cluster.

**Contemporary alternative (2026):** deploy the same two images to Cloud Run instead of GKE
(`gcloud run deploy --source .`) and protect the frontend with `--iap`; for a project inside a
Google Workspace organisation that needs no OAuth client at all (Google-managed client), and
for a project outside one the consent screen is still the only manual step. See the
Modernization roadmap at the repository root.

## Debrief

Which of the three labs removed the most risk for the agency, and which added the most
operational burden? If the agency later hires contractors without Google accounts, what
changes?

## What changed in the industry, April to October 2026

- **Agents are production workloads.** Google's Gemini Enterprise Agent Platform (Next 2026)
  with an Agent Registry and Marketplace, Microsoft Foundry hosted agents with per-session
  sandboxes and an Agent Control Specification (Build 2026), and AWS Bedrock AgentCore's GA
  harness, eight-hour sessions and dedicated runtime instances. A timesheet an agent can call
  is now a normal product requirement.
- **MCP is the integration standard.** The Model Context Protocol moved to the Linux Foundation's
  Agentic AI Foundation (December 2025) with AWS, Google, Microsoft and Cloudflare as platinum
  members; all three clouds host MCP servers (Bedrock AgentCore, Azure Functions, managed
  servers for BigQuery and Spanner). More than 10,000 public servers were listed by April 2026.
- **Zero trust at the edge, for agents too.** IAP in Lab 4.5 proves identity before any data;
  the same check must sit in front of an agent's tools. GKE Agent Sandbox adds pod-level
  isolation for the agent itself.

### Across the providers: agents and identity at the edge (October 2026)

| Provider | What it offers for this week |
|---|---|
| AWS | Bedrock AgentCore (GA harness, 8-hour sessions, MCP servers); ALB with Cognito or Verified Access gates the app |
| Azure | Foundry hosted agents, Foundry IQ, Agent Control Specification; App Service Easy Auth with Entra |
| Google Cloud | Gemini Enterprise Agent Platform, GKE Agent Sandbox; IAP on the HTTPS load balancer (this lab) |
| DigitalOcean | Gradient AI cloud: GPU Droplets on AMD MI350X (Feb 2026) and NVIDIA B300, inference engine, agents; gradient ADK deprecated Oct 1, 2026 |
| Oracle Cloud | OCI Enterprise AI (May 2026), Oracle AI Database Agent for Gemini Enterprise (preview), Select AI supervisor agents |

Market context (Synergy Research, Q2 2026): 143.4 billion dollars in the quarter, up 43 percent; AWS 28, Azure 20, Google 15 percent.

Sources for this section:
- https://en.wikipedia.org/wiki/Model_Context_Protocol (Agentic AI Foundation, December 2025)
- https://www.infoq.com/news/2026/06/microsoft-foundry-agents/
- https://aws.amazon.com/about-aws/whats-new/2026/04/agentcore-new-features-to-build-agents-faster/
- https://cloud.google.com/blog/topics/google-cloud-next/google-cloud-next-2026-wrap-up

### AI and automation extension (optional, 45 min)

1. **Agent-ready API:** `mcp/server.js` wraps the timesheet API in three MCP tools, and its
   schema refuses a patient name in `patientCode`. Run `npm test` in `mcp/` against the Lab
   4.3 backend, then register the server with Gemini CLI, Copilot CLI or Claude Code and ask
   it to record a visit and total the hours. Screenshot the tool calls.
2. **Compliance question:** the agent's server talks to the API directly. Which of the Lab 4.5
   controls still apply to it (IAP, IAM role, audit log), and what does an agent present
   instead of a browser sign-in? (A short-lived token for a service identity, Week 5.)
3. **Platform step:** deploy `mcp/` as a third Deployment on the cluster with a ClusterIP
   Service, so the only public surface stays the frontend. A `NetworkPolicy` from Week 3 keeps
   the backend reachable only from the frontend and the MCP server.

## Instructor runs

2026-10-24 (laptop and a second instructor project), 2026-10-29 and 2026-10-30 (project jackson-isiko,
cluster in us-east1-b), and a verification run on 2026-10-31 (same project and zone).

| Lab | Result |
|---|---|
| 4.3 | both containers Up on the `timesheet` network; three visits saved through the frontend; backend stopped → request fails fast instead of hanging; rolled back |
| 4.4 | images in Artifact Registry; cluster `timpanogos` (1 e2-medium); backend 1/1, frontend 2/2; EXTERNAL-IP 34.44.167.217 served the app and accepted a visit; port 5000 unreachable from the internet, reachable from a pod; frontend scaled to 3 with the same IP; rolled back (cluster and registry deleted) |
| 4.4 (2026-10-29) | same steps in us-east1-b (us-central1 external IPs nearly all in use); EXTERNAL-IP 34.139.151.51 served the app; port 5000 unreachable from the internet, reachable from a pod; scaled to 3 with the same IP; rolled back |
| 4.5 (2026-10-30) | consent screen and client `timesheet-iap` created in the console; `deploy-lab4-3.sh` with the client pair; static IP 34.36.37.188, host 34-36-37-188.nip.io; certificate Active after 18 minutes; grant, Google sign-in, app behind IAP; SetIamPolicy history read; the AuthorizeUser query was empty because Data Access logs were switched on after the test (the script now does it first); rolled back |
| 4.3 and 4.4 (2026-10-31) | `curl -s localhost:3000/api/health` printed `{"status":"ok"}`; with the backend stopped `curl -m 5` through port 3000 returned 504 after 2.0 s; `gcloud artifacts docker images list ... --include-tags` showed TAGS `1.0` for both images (without `--include-tags` there is no tag column); port 5000 on the external IP returned `000`; the busybox probe printed the saved visits; the frontend pods showed RESTARTS 3, and `kubectl logs <pod> --previous` ended with `nginx: [emerg] host not found in upstream "backend"`. Lab 4.5 was not re-run |
| 4.3, 4.4 and 4.5 (2026-11-15) | the v2 student guides end to end. 4.3 on a Mac (Docker 28.4.0, Node 24): API on 5001, Vite with `API=http://localhost:5001`, both containers Up, backend stopped → HTTP 504 in 2.0 s, fresh clone + README commands → both Up. 4.4 in Cloud Shell (Docker 29.9.3): first cluster attempt failed with `Quota 'SSD_TOTAL_GB' exceeded` (two Week 3 Autopilot clusters in us-central1), recreated with `--disk-type pd-standard --disk-size 50` and RUNNING in 6.5 min; images in Artifact Registry; backend 1/1 and frontend 2/2 in 45 s; EXTERNAL-IP 34.41.243.217; port 5000 timed out from the internet, the busybox probe printed the visits; scaled to 3 with the same IP. 4.5: without an OAuth client IAP answered `Empty Google Account OAuth client ID(s)/secret(s).`; with the `timesheet-iap` client ID, static IP 8.232.54.173, certificate Active in 17 min, every unsigned request 302 to accounts.google.com, frontend patched to ClusterIP (old IP returned 000, the HTTPS path kept working), role granted with `gcloud iap web add-iam-policy-binding`; `AuthorizeUser` and `SetIamPolicy` entries in the audit log (resource type `gce_backend_service`). A full sign-in was not completed (needs the client secret and a browser) |
