---
title: Aerosphere
emoji: 🌎
colorFrom: green
colorTo: purple
sdk: gradio
sdk_version: 6.18.0
python_version: '3.12'
app_file: app.py
pinned: false
license: mit
short_description: A 3D planetary ecosystem driven by an 8B model.
tags:
  - track:wood
  - sponsor:nvidia
  - sponsor:modal
  - achievement:offgrid
  - achievement:offbrand
  - achievement:sharing
  - achievement:fieldnotes
---

# AeroSphere
**A local LLM-driven planetary physics engine. AeroSphere translates stateless natural language generation into continuous, real-time WebGL/Three.js state machine transitions.**

Submission for the Build Small Hackathon · Chapter Two · An Adventure in Thousand Token Wood.

[Live demo](https://huggingface.co/spaces/build-small-hackathon/aerosphere) · [Public GitHub repo](https://github.com/rAdvirtua/aerosphere) · [HF Space repo](https://huggingface.co/spaces/build-small-hackathon/aerosphere/tree/main)

**Presentations:** [Social Media Post](https://www.linkedin.com/posts/itsanurag-paul_buildsmallhackathon-huggingface-threejs-ugcPost-7472002881706110976-WWNb/?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=ACoAAE5X43sBOTHkuI1k1vjlYTqaFWY3FOJjsDg) · [Tech Demo Video](https://youtu.be/q_wNTPyrij4?si=TGCrrUaCCVzXtG1j) · [Field Notes Blog Post](https://huggingface.co/blog/build-small-hackathon/aerosphere-blog)

---

## Architecture Overview
AeroSphere challenges the traditional `text-in, text-out` paradigm of LLMs. It utilizes an 8-Billion parameter inference loop natively as the core logical backend required to interpolate rendering parameters for a live 3D environment.

### 1. Physics Inference Engine 
*   **Model:** `nvidia/Mistral-NeMo-Minitron-8B-Instruct`
*   **Local Execution:** Runs locally via the `transformers` pipeline. On Hugging Face Spaces, it leverages the `@spaces.GPU` ZeroGPU binding to keep operations 100% off-the-grid without routing to external vendor APIs.
*   **State Constraint:** To prevent the renderer from crashing on hallucinated math variables, the Python backend binds the Mistral-8B payload strictly using `Pydantic` schemas. The LLM is forced to extract normalized `PlanetStateDelta` floats (e.g., `lava_intensity: 0.85`).

### 2. State Sync Pipeline
1.  **Context Construction:** The system aggregates user prompts alongside a rolling computational buffer of the planet's previous chronological iterations.
2.  **LLM Inference:** Mistral-8B predicts the geological and atmospheric consequences zero-shot.
3.  **JSON Payload:** The backend resolves a `JSON` configuration block housing exact physical constants.
4.  **Shader Bridging:** A client-side listener injects this payload synchronously into the running DOM.

### 3. Rendering Engine (Three.js WebGL)
To retain blazing-fast delivery and circumvent 100MB+ WebAssembly game engine bundles like Unity, the environment calculates visual states procedurally on the native device GPU using **Three.js**:
*   The planet mesh ignores static image textures, computing environments using complex custom **GLSL Fragment Shaders**.
*   **Fractal Brownian Motion (FBM)** noise equations are manipulated by the JSON floats to dynamically shift continents, freeze oceans, and illuminate procedural populations.
*   Network/Inference latency is masked locally via `Linear Interpolation (.lerp())`, allowing smooth, unbroken animations while the backend processes the Next State loop.

---

## UI/UX: The Gradio "CSS Heist"
AeroSphere implements a massive DOM override to convert standard Gradio columns into an immersive cinematic Single Page Application (SPA).
* **Canvas Injection:** Uses `gr.HTML(bg_html)` to inject the raw WebGL instances permanently into the background layout level, preventing React hydration logic from wiping the active render context.
* **Layout Decoupling:** `style.css` (~1,400 lines) forcibly disables Gradio's internal `gap` grids and replaces the interface with fixed, absolute-positioned glassmorphic overlay elements mimicking game UI layers.
* **Mobile Viewport Optimization:** Converts scaling calculations to strict `100dvh` units coupled with native `env(safe-area-inset-bottom)` rules. This prevents catastrophic UI jittering caused by native iOS/Android address bars collapsing on touch input.

---

## Hackathon Tracks & Merit Badges
- **An Adventure in Thousand Token Wood (Main Track)** — Built explicitly for this track. It introduces a highly experimental user capability that surprises the player entirely via load-bearing LLM manipulation.
- **NVIDIA Nemotron Quest** — Employs `Mistral-NeMo-Minitron-8B-Instruct` zero-shot to calculate real-time deterministic game logic loops.

| Badge | Status | Technical Requirement Satisfied |
| --- | --- | --- |
| Off-Brand 🎨 | Claimed | Executed a DOM override converting standard Gradio blocks into a cinematic glassmorphic Three.js 3D application. |
| Field Notes 📓 | Claimed | Thorough technical blog post documenting the pipeline transitions from Pydantic logic constraints into WebGL procedural fragments. |
| Off the Grid 🔌 | Claimed | ZERO network-reliant inferences outside the deployment layer. Built purely via local automated `transformers` pipelines running locally via ZeroGPU caching rules. |
| Sharing is Caring 📡 | Claimed | Compiled and uploaded an extensive `aerosphere-agent-traces` trace history dataset. By exporting our JSON vessel logs to the Hub, we open-sourced the underlying inference deltas so local LLM developers can observe exactly how we map text inputs to physical environment constraints. |
| Well-Tuned 🎯 | Skipped | No parameter-level fine-tuning required. The application relies perfectly on Zero-Shot schema extraction. |
| Llama Champion 🦙 | Skipped | Model logic resolves primarily into the native Mistral context architectures. |

---

## Local Development

Clone the repository and install the requirements via `uv` or standard `pip`.

```bash
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt
python app.py
```
