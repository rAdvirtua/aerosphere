from pydantic import BaseModel, Field
import json
import re
from enum import Enum
import os

class HabitabilityStatus(str, Enum):
    STERILE = "STERILE"
    PREBIOTIC = "PREBIOTIC"
    HABITABLE = "HABITABLE"
    THRIVING = "THRIVING"

class Era(str, Enum):
    PRIMORDIAL = "PRIMORDIAL"
    PRE_FORMATION = "PRE_FORMATION"
    HADEAN = "HADEAN"
    ARCHEAN = "ARCHEAN"
    PROTEROZOIC = "PROTEROZOIC"
    PALEOZOIC = "PALEOZOIC"
    MESOZOIC = "MESOZOIC"
    CENOZOIC = "CENOZOIC"
    ANTHROPOCENE = "ANTHROPOCENE"
    MICROBIAL = "MICROBIAL"
    COMPLEX_LIFE = "COMPLEX_LIFE"
    MEGAFAUNA = "MEGAFAUNA"
    PRIMATE = "PRIMATE"
    TRIBAL = "TRIBAL"
    ANCIENT_MEDIEVAL = "ANCIENT_MEDIEVAL"
    INDUSTRIAL = "INDUSTRIAL"
    MODERN = "MODERN"
    ADVANCED = "ADVANCED"

class PlanetState(BaseModel):
    narrative: str = Field(default="The planet holds stable under observation.")
    metric_name: str = Field(default="Atmospheric Harmony")
    metric_value: float = Field(default=50.0)
    button_a_label: str = Field(default="Observe")
    button_b_label: str = Field(default="Analyze")
    planet_color_hex: str = Field(default="#1e7050")
    atmosphere_color_hex: str = Field(default="#40d0a0")
    population: int = Field(default=0)
    cloud_density: float = Field(default=0.0)
    storm_intensity: float = Field(default=0.0)
    lava_intensity: float = Field(default=0.0)
    ice_coverage: float = Field(default=0.0)
    vegetation: float = Field(default=0.0)
    ocean_level: float = Field(default=0.0)
    land_mass: float = Field(default=0.0)
    habitability: "HabitabilityStatus" = Field(default=HabitabilityStatus.STERILE)
    evolution_age: int = Field(default=0)
    tech_level: float = Field(default=0.0)
    civilization_scale: float = Field(default=0.0)
    biosphere_richness: float = Field(default=0.0)
    current_era: "Era" = Field(default=Era.PRIMORDIAL)
    entities: list = Field(default_factory=list)

class PlanetStateDelta(BaseModel):
    narrative: str = Field(description="Explain what happened.")
    lava_intensity: float = Field(default=None)
    ice_coverage: float = Field(default=None)
    planet_color_hex: str = Field(default=None)
    atmosphere_color_hex: str = Field(default=None)
    vegetation: float = Field(default=None)
    ocean_level: float = Field(default=None)
    land_mass: float = Field(default=None)

def compute_era(age: int) -> tuple[str, float]:
    if age < 0: return ("PRE_FORMATION", 0.0)
    if age < 50_000_000: return ("HADEAN", 0.0)
    elif age < 150_000_000: return ("ARCHEAN", 0.0)
    elif age < 250_000_000: return ("PROTEROZOIC", 0.1)
    elif age < 350_000_000: return ("PALEOZOIC", 0.2)
    elif age < 450_000_000: return ("MESOZOIC", 0.3)
    elif age < 550_000_000: return ("CENOZOIC", 0.5)
    else: return ("ANTHROPOCENE", 1.0)

def tick_planet(state: PlanetState, delta_t: float) -> PlanetState:
    state.lava_intensity = max(0.0, state.lava_intensity - (0.05 * delta_t))
    state.storm_intensity = max(0.0, state.storm_intensity - (0.02 * delta_t))
    return state

def check_habitability(state: PlanetState) -> HabitabilityStatus:
    if state.lava_intensity > 0.6 or state.ice_coverage > 0.8: return HabitabilityStatus.STERILE
    elif state.ocean_level > 0.3 and state.vegetation < 0.1: return HabitabilityStatus.PREBIOTIC
    elif state.vegetation >= 0.1 and state.population < 1000: return HabitabilityStatus.HABITABLE
    else: return HabitabilityStatus.THRIVING

# --- ZeroGPU Architecture Hook ---
try:
    import spaces
except ImportError:
    # Dummy mock for local CPU testing
    class spaces:
        @staticmethod
        def GPU(*args, **kwargs):
            if len(args) == 1 and callable(args[0]): return args[0]
            return lambda fn: fn

from huggingface_hub import snapshot_download

def init_llm():
    """ 
    Pre-downloads the model weights onto the CPU host's cache to completely 
    avoid eating into the strict 60s ZeroGPU quota!
    """
    print("[AeroSphere] Pre-flight CPU model download initiating...")
    snapshot_download("nvidia/Mistral-NeMo-Minitron-8B-Instruct", ignore_patterns=["*.msgpack", "*.h5", "*.ot", "*.safetensors.index.json"])
    print("[AeroSphere] Pre-flight CPU model downloaded successfully!")

llm_pipeline = None

@spaces.GPU(duration=60)
def infer_llm(messages: list) -> str:
    from transformers import pipeline
    import torch
    global llm_pipeline
    if llm_pipeline is None:
        llm_pipeline = pipeline("text-generation", model="nvidia/Mistral-NeMo-Minitron-8B-Instruct", device_map="auto", torch_dtype=torch.bfloat16)
    resp = llm_pipeline(messages, max_new_tokens=400, return_full_text=False, temperature=0.7)
    return resp[0]["generated_text"].strip()

def get_next_planet_state(user_input: str, history: list, core_state_dict: dict = None) -> PlanetState:
    state = core_state_dict or {}
    schema = PlanetStateDelta.model_json_schema()
    SYSTEM = f"""You are the AeroSphere Tectonic Evolution Engine. Control physical state based on user interventions.
Output MUST be strict JSON matching this Delta schema (do NOT include unchanged variables!):
{json.dumps(schema)}"""

    user_msg = f"Current State:\n{json.dumps(state)}\n\nUser Intervention: {user_input}\n\nEvolve logically! Do NOT add unrequested JSON fields."
    
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_msg}
    ]
    
    try:
        raw_output = infer_llm(messages)
    except Exception as e:
        state["narrative"] = f"ZeroGPU Inference Failure: {e}"
        state_obj = PlanetState.model_validate(state)
        state_obj.habitability = check_habitability(state_obj)
        return state_obj
        
    start_idx = raw_output.find('{')
    if start_idx != -1:
        raw_output = raw_output[start_idx:]
        try:
            delta, _ = json.JSONDecoder().raw_decode(raw_output)
            valid_keys = PlanetStateDelta.model_fields.keys()
            for k, v in delta.items():
                if k in valid_keys and v is not None:
                    state[k] = v
        except Exception as e:
            state["narrative"] = f"LLM parsing error: {e}"
    else:
        state["narrative"] = "LLM parsing error: No JSON block found in output."
        
    final_state = PlanetState.model_validate(state)
    final_state.habitability = check_habitability(final_state)
    return final_state
