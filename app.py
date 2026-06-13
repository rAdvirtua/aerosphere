import gradio as gr
from engine import get_next_planet_state, HabitabilityStatus
import time

with open('assets/style.css', 'r', encoding='utf-8') as f:
    RAW_CSS = f.read()

with open('assets/planet.js', 'r', encoding='utf-8') as f:
    RAW_JS = f.read()

HEAD_INJECT = f"""
<style>{RAW_CSS}</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400..900&family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script>
const script1 = document.createElement('script');
script1.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
script1.onload = () => {{
    const script2 = document.createElement('script');
    script2.src = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js";
    document.head.appendChild(script2);
}};
document.head.appendChild(script1);
</script>
<script>
""" + RAW_JS + """
</script>
<audio id="ambient-track" loop src="https://cdn.pixabay.com/download/audio/2021/11/24/audio_3a6a9bebbd.mp3" preload="auto"></audio>
<script>
  document.addEventListener('click', () => { 
    let aud = document.getElementById('ambient-track'); 
    if(aud.paused) { aud.volume = 0.3; aud.play(); } 
  }, {once: true});
</script>
"""

def init_llm_eager():
    print("[AeroSphere] Awakening AeroSphere Cloud Endpoints...")
    try:
        from engine import init_llm
        init_llm()
    except Exception as e:
        print(f"Eager loading failed: {e}")
    print("[AeroSphere] Neural link established. Resolving UI.")
    return "READY"

def handle_interaction(user_input, history, core_state):
    try:
        from engine import get_next_planet_state
        state = get_next_planet_state(user_input, history, core_state)
        new_core_state = state.model_dump(mode='json')
        new_core_state["entities"] = []
        new_core_state_str = __import__('json').dumps(new_core_state)
            
        # Failsafe overlay hide if eager load lagged
        hide_overlay_str = "<script>let o=document.getElementById('aerosphere-loading-overlay');if(o){o.style.opacity='0';setTimeout(()=>o.style.display='none',1000);}</script>"
        
        new_history = history + [{"role": "user", "content": user_input}, {"role": "assistant", "content": state.narrative}]
        history_html = '<div class="aerosphere-console-history" id="console-history">'
        for turn in new_history[-6:]: 
            if turn["role"] == "user":
                history_html += f'<div><span style="color:rgba(100,200,180,0.5)">›</span> {turn["content"]}</div>'
            else:
                history_html += f'<div style="color:rgba(160, 185, 200, 0.4);">{turn["content"][:60]}...</div>'
        history_html += '</div>'
        badge_val = getattr(state, "habitability", "STERILE")
        if hasattr(badge_val, "value"): badge_val = badge_val.value
        badge_color = "warning" if badge_val == "STERILE" else "nominal"
        badge_html = f'<div class="aerosphere-status-badge {badge_color}">{badge_val}</div><div class="aerosphere-tech-badge">TECH: {getattr(state, "tech_level", 0.0):.2f}</div>'
        return (
            new_history, 
            hide_overlay_str + state.narrative + "<span class='aerosphere-cursor-blink'></span>", 
            gr.update(label=state.metric_name, value=state.metric_value),
            gr.update(value=state.button_a_label),
            gr.update(value=state.button_b_label),
            "", 
            history_html,
            new_core_state_str,
            new_core_state,
            badge_html,
            gr.update(value=f"🧬 EVOLVE CIVILIZATION" if getattr(state, "evolution_age", 0) >= 20_000_000 else ("🧬 SEED LIFE" if badge_val != "STERILE" else "🧬 SEED LIFE (LOCKED)"), interactive=(badge_val != "STERILE"))
        )
    except Exception as e:
        import traceback
        trace_str = traceback.format_exc()
        # Fallback dump safely avoiding schema drops!
        return (
            history,
            f"FATAL UI CRASH: {e}\n{trace_str}",
            gr.update(label="Crash", value=0),
            gr.update(value="Crash"),
            gr.update(value="Crash"),
            user_input,
            "<code>Crash State Isolated.</code>",
            "{}",
            core_state,
            '<div class="aerosphere-status-value warning">ERROR</div>',
            gr.update(interactive=False)
        )

def reset_sim():
    from engine import PlanetState
    hadean = PlanetState(
        narrative="SYSTEM RESET. Hadean eon initiated. The planet is a hostile volcanic fireball.",
        metric_name="Core Instability", metric_value=99.9,
        lava_intensity=1.0, cloud_density=0.9, storm_intensity=0.8,
        ocean_level=0.0, vegetation=0.0, ice_coverage=0.0, land_mass=0.0,
        planet_color_hex="#ff1e00", atmosphere_color_hex="#ff4400"
    )
    hadean_dump = hadean.model_dump()
    hadean_dump_str = hadean.model_dump_json()
    return (
        [], # history
        hadean.narrative + "<span class='aerosphere-cursor-blink'></span>",
        gr.update(label=hadean.metric_name, value=hadean.metric_value),
        gr.update(value=hadean.button_a_label),
        gr.update(value=hadean.button_b_label),
        "", # console input
        '<div class="aerosphere-console-history" id="console-history"><div><span style="color:rgba(100,200,180,0.5)">›</span> SYSTEM FORMAT COMPLETE</div></div>',
        hadean_dump_str, # js mapping
        hadean_dump, # core state
        '<div class="aerosphere-status-badge warning">STERILE</div><div class="aerosphere-tech-badge">TECH: 0.00</div>',
        gr.update(value="🧬 SEED LIFE (LOCKED)", interactive=False)
    )

bg_html = f"""
<div id="aerosphere-loading-overlay" class="aerosphere-loading-overlay">
   <div class="aerosphere-loader-spinner"></div>
   <div class="aerosphere-loader-text">ESTABLISHING NEURAL LINK TO GENESIS MATRIX...</div>
   <div class="aerosphere-loader-subtext">Initializing Core LLM Weights into VRAM</div>
</div>
<canvas id="aerosphere-planet-canvas" class="aerosphere-canvas-layer"></canvas>
<div class="aerosphere-nebula-layer"></div>
<div class="aerosphere-scanline-overlay"></div>
<div class="aerosphere-vignette-overlay"></div>
<div class="aerosphere-hud-grid"></div>
<div class="aerosphere-reticle"></div>
<div class="aerosphere-edge-top"></div>
<div class="aerosphere-edge-bottom"></div>
<div class="aerosphere-corner-tl"></div>
<div class="aerosphere-corner-tr"></div>
<div class="aerosphere-corner-bl"></div>
<div class="aerosphere-corner-br"></div>
<div id="svg-lifeform-layer" class="aerosphere-svg-layer" style="display:none; pointer-events: none; position: absolute; inset:0; z-index: 50;"></div>
<button id="aerosphere-ascend-btn" class="aerosphere-ascend-btn" onclick="window.setCameraMode('ASCENDING')" style="display:none; position:absolute; top:80px; left:50%; transform:translateX(-50%); z-index:100; font-family:'Orbitron', sans-serif; background:rgba(0,0,0,0.8); color:#50e0c0; border:1px solid #50e0c0; padding:10px 20px; font-weight:700; cursor:pointer;">🚀 ASCEND TO ORBIT</button>
"""

with gr.Blocks(title="AeroSphere HUD") as demo:
    history_state = gr.State([])
    gr.HTML(bg_html)
    hadean_default = {
        "narrative": "SYSTEM RESET. Hadean eon initiated.",
        "metric_name": "Core Instability", "metric_value": 99.9,
        "lava_intensity": 1.0, "cloud_density": 0.9, "storm_intensity": 0.8,
        "ocean_level": 0.0, "vegetation": 0.0, "ice_coverage": 0.0, "land_mass": 0.0,
        "planet_color_hex": "#ff1e00", "atmosphere_color_hex": "#ff4400"
    }
    
    import json
    js_inject = gr.Textbox(value=json.dumps(hadean_default), visible=False, elem_id="js_inject")
    
    with gr.Row(elem_classes=["aerosphere-habitability-panel"]):
        gr.HTML('<div class="aerosphere-panel-label" style="display:inline-block; margin-right: 15px;">Planetary Status</div>')
        habitability_badge = gr.HTML('<div class="aerosphere-status-badge warning">STERILE</div><div class="aerosphere-tech-badge">TECH: 0.00</div>')

    with gr.Row(elem_classes=["aerosphere-body"]):
        with gr.Column(elem_classes=["aerosphere-node-telemetry", "aerosphere-glass-panel"]):
            gr.HTML('<div class="aerosphere-panel-label">Aether Resonance</div>')
            gr.HTML('<div class="aerosphere-telemetry-value" id="telemetry-value">64</div><div class="aerosphere-telemetry-unit">resonance index · hz</div>')
            telemetry_slider = gr.Slider(minimum=0, maximum=100, value=64, label="", elem_classes=["aerosphere-range-slider"])
            gr.HTML('<div class="aerosphere-telemetry-bar" id="telemetry-bar" style="width: 64%;"></div>')
        with gr.Column(elem_classes=["aerosphere-node-status", "aerosphere-glass-panel"]):
            gr.HTML('<div class="aerosphere-panel-label">Sys Diagnostics</div>')
            gr.HTML("""
            <div class="aerosphere-status-row">
              <span class="aerosphere-status-label">Hull</span><span class="aerosphere-status-value" id="status-hull">98.2%</span>
            </div>
            <div class="aerosphere-status-row">
              <span class="aerosphere-status-label">Reactor</span><span class="aerosphere-status-value" id="status-reactor">Online</span>
            </div>
            <div class="aerosphere-status-row">
              <span class="aerosphere-status-label">Shields</span><span class="aerosphere-status-value warning" id="status-shields">72.1%</span>
            </div>
            <div class="aerosphere-status-row">
              <span class="aerosphere-status-label">Comms</span><span class="aerosphere-status-value" id="status-comms">Nominal</span>
            </div>
            """)
        with gr.Column(elem_classes=["aerosphere-node-actions", "aerosphere-glass-panel"]):
            gr.HTML('<div class="aerosphere-panel-label">Action Matrix</div>')
            btn_a = gr.Button("Stabilize Core", elem_classes=["aerosphere-action-btn"])
            btn_b = gr.Button("Extract Luminescence", elem_classes=["aerosphere-action-btn"])
            btn_genesis = gr.Button("✧ Genesis Spark", elem_classes=["aerosphere-action-btn", "special-btn"])
            btn_evolve = gr.Button("🧬 SEED LIFE (LOCKED)", interactive=False, elem_classes=["aerosphere-action-btn", "special-btn"])
            btn_reset = gr.Button("Format Matrix (Reset)", elem_classes=["aerosphere-action-btn", "danger-btn"])
            
            telemetry_slider = gr.Slider(minimum=0, maximum=100, value=50, step=1, label="Atmospheric Harmony", interactive=False)
            
        with gr.Column(elem_classes=["aerosphere-node-narrative", "aerosphere-glass-panel"]):
            gr.HTML('<div class="aerosphere-panel-label">Vessel Log · Encrypted</div>')
            narrative_text = gr.Markdown("Stardate 2387.04 — Vessel drifts through the Lyrae Nebula. Sensor arrays detect faint particulate resonance at bearing 217 mark 4. The aether envelope holds, though hull micro-fractures along the port nacelle suggest prior engagement with a gravimetric anomaly. Engineering reports reactor output steady at 94.7%. Forward observation confirms visual on a tertiary exoplanet — spectral class M, tidally locked, low albedo. No transponder signatures within effective range.<span class='aerosphere-cursor-blink'></span>")
            gr.HTML('<div class="aerosphere-narrative-timestamp" id="narrative-timestamp">◆ Timestamp: Syncing...</div>')
        with gr.Column(elem_classes=["aerosphere-node-console", "aerosphere-glass-panel"]):
            gr.HTML('<div class="aerosphere-panel-label">Override Console</div>')
            gr.HTML('<div class="aerosphere-console-prompt">aero@vessel:~$</div>')
            console_input = gr.Textbox(placeholder="Enter intervention directive...", elem_classes=["aerosphere-console-input"], container=False)
            btn_export = gr.Button("💾 Export Vessel Logs", elem_classes=["aerosphere-action-btn"])
            export_file = gr.File(label="Exported Telemetry Data", visible=False)
            console_history_html = gr.HTML('<div class="aerosphere-console-history" id="console-history"></div>')

    core_state = gr.State(hadean_default)

    inputs_list = [console_input, history_state, core_state]
    outputs_list = [history_state, narrative_text, telemetry_slider, btn_a, btn_b, console_input, console_history_html, js_inject, core_state, habitability_badge, btn_evolve]
    
    # Tick Planet Logic
    def handle_tick(history, cs):
        from engine import PlanetState, tick_planet
        state = PlanetState.model_validate(cs)
        state = tick_planet(state, delta_t=1.0) # approx 1 second of real world time
        new_cs = state.model_dump(mode='json')
        new_cs_str = state.model_dump_json()
        badge_val = state.habitability.value if hasattr(state.habitability, "value") else state.habitability
        badge_color = "warning" if badge_val == "STERILE" else "nominal"
        
        lbl = "🧬 EVOLVE CIVILIZATION" if getattr(state, "evolution_age", 0) >= 20_000_000 else ("🧬 SEED LIFE" if badge_val != "STERILE" else "🧬 SEED LIFE (LOCKED)")
        btn_update = gr.update(value=lbl, interactive=(badge_val != "STERILE"))
        
        return new_cs, new_cs_str, f'<div class="aerosphere-status-badge {badge_color}">{badge_val}</div><div class="aerosphere-tech-badge">TECH: {state.tech_level:.2f}</div>', btn_update

    tick_timer = gr.Timer(value=1)
    tick_timer.tick(fn=handle_tick, inputs=[history_state, core_state], outputs=[core_state, js_inject, habitability_badge, btn_evolve])
    
    def handle_fast_forward(history, cs):
        from engine import PlanetState, compute_era, check_habitability, HabitabilityStatus, Era
        state = PlanetState.model_validate(cs)
        if state.habitability in ["STERILE", getattr(HabitabilityStatus, "STERILE", "STERILE")]:
            return cs, cs, f'<div class="aerosphere-status-badge warning">STERILE</div><div class="aerosphere-tech-badge">TECH: 0.00</div>', gr.update(value="🧬 SEED LIFE (LOCKED)", interactive=False)
            
        state.evolution_age += 85_000_000
        era, tech = compute_era(state.evolution_age)
        state.current_era = getattr(Era, era) if hasattr(Era, era) else era
        state.tech_level = tech
        state.habitability = check_habitability(state)
        
        from engine import get_next_planet_state
        state = get_next_planet_state(f"Massive time jump: 85 million years elapsed. The planet enters the {era} period.", history, state.model_dump())
        
        new_cs = state.model_dump(mode='json')
        new_cs["entities"] = []
        new_cs_str = __import__('json').dumps(new_cs)
            
        badge_val = state.habitability.value if hasattr(state.habitability, "value") else state.habitability
        badge_color = "warning" if badge_val == "STERILE" else "nominal"
        bdg = f'<div class="aerosphere-status-badge {badge_color}">{badge_val}</div><div class="aerosphere-tech-badge">TECH: {state.tech_level:.2f}</div>'
        
        lbl = "🧬 EVOLVE CIVILIZATION" if getattr(state, "evolution_age", 0) >= 20_000_000 else "🧬 SEED LIFE"
        return new_cs, new_cs_str, bdg, gr.update(value=lbl, interactive=True)


    console_input.submit(fn=handle_interaction, inputs=inputs_list, outputs=outputs_list, js="(user_input, h, cs) => { window.handleAction('submit'); if (window.triggerShockwave) window.triggerShockwave(); return [user_input, h, cs]; }")
    btn_a.click(fn=lambda h, a_lbl, cs: handle_interaction(f"Execute directive: {a_lbl}", h, cs), inputs=[history_state, btn_a, core_state], outputs=outputs_list, js="(h, a, cs) => { window.handleAction('stabilize'); return [h, a, cs]; }")
    btn_b.click(fn=lambda h, b_lbl, cs: handle_interaction(f"Execute directive: {b_lbl}", h, cs), inputs=[history_state, btn_b, core_state], outputs=outputs_list, js="(h, b, cs) => { window.handleAction('extract'); return [h, b, cs]; }")    
    btn_genesis.click(fn=lambda h, cs: handle_interaction("Terraform into an Earth-like biological paradise. Set ice_coverage and lava_intensity to 0.0. Increase vegetation to 0.8, ocean_level to 0.6, and land_mass to 0.5, cloud_density to 0.7, storm_intensity to 0.5. Strictly set planet_color_hex to green (#1e7050) and atmosphere_color_hex to sky blue (#40d0a0).", h, cs), inputs=[history_state, core_state], outputs=outputs_list, js="(h, cs) => { window.handleAction('submit'); if (window.triggerShockwave) window.triggerShockwave(); return [h, cs]; }")
    btn_evolve.click(fn=handle_fast_forward, inputs=[history_state, core_state], outputs=[core_state, js_inject, habitability_badge, btn_evolve], js="(h, cs) => { window.handleAction('extract'); if (window.triggerShockwave) window.triggerShockwave(); return [h, cs]; }")
    btn_reset.click(fn=reset_to_hadean, inputs=[], outputs=outputs_list, js="() => { window.handleAction('submit'); if (window.triggerShockwave) window.triggerShockwave(); return []; }")
    
    init_trigger = gr.Textbox(visible=False, elem_id="hidden_init_trigger")
    
    hidden_interact_payload = gr.Textbox(visible=False, elem_id="hidden_interact_payload")
    hidden_interact_btn = gr.Button("HiddenInteract", visible=False, elem_id="hidden_interact_btn")
    
    hidden_interact_btn.click(
        fn=handle_interaction,
        inputs=[hidden_interact_payload, history_state, core_state],
        outputs=outputs_list,
        js="(p, h, cs) => { window.handleAction('submit'); return [p, h, cs]; }"
    )
    
    def handle_export(cs):
        import json, tempfile, os
        path = os.path.join(tempfile.gettempdir(), "aerosphere_vessel_telemetry.json")
        with open(path, "w") as f:
            json.dump(cs, f, indent=4)
        return gr.update(value=path, visible=True)

    btn_export.click(fn=handle_export, inputs=[core_state], outputs=[export_file])
    
    js_inject.change(fn=None, inputs=[js_inject], outputs=None, js="(state) => { if (state && window.updatePlanet) { setTimeout(() => window.updatePlanet(state), 300); } }")
    demo.load(fn=init_llm_eager, inputs=[], outputs=[init_trigger], js="() => { const tryInit = () => { if (window.THREE && window.THREE.OrbitControls && window.initAeroSpherePlanet) { window.initAeroSpherePlanet(); } else { setTimeout(tryInit, 50); } }; tryInit(); return []; }")
    
    hide_overlay_js = "() => { let overlay = document.getElementById('aerosphere-loading-overlay'); if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 1000); } }"
    init_trigger.change(fn=None, inputs=[], outputs=[], js=hide_overlay_js)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860, allowed_paths=["assets"], head=HEAD_INJECT)
