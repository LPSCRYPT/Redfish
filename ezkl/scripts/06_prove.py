import ezkl
import asyncio
import json
from ezkl_config import *

WITNESS_PATH = BUILD_DIR / "witness.json"
PROOF_PATH = BUILD_DIR / "proof.json"

async def main():
    logger.info("--- Step 6: Generate Proof ---")
    
    # 1. Generate Witness
    logger.info("Generating witness...")
    res = ezkl.gen_witness(
        data=str(INPUT_PATH),
        model=str(COMPILED_PATH),
        output=str(WITNESS_PATH),
        vk_path=str(VK_PATH),
        srs_path=str(SRS_PATH)
    )
    
    if os.path.exists(WITNESS_PATH):
        logger.info(f"Witness saved to {WITNESS_PATH}")
    else:
        logger.error("Witness generation failed")
        return

    # 2. Generate Proof
    logger.info("Generating proof...")
    # Using 'model' instead of 'compiled_circuit' per setup experience
    # Removed 'proof_type'
    
    res = ezkl.prove(
        witness=str(WITNESS_PATH),
        model=str(COMPILED_PATH),
        pk_path=str(PK_PATH),
        proof_path=str(PROOF_PATH),
        srs_path=str(SRS_PATH)
    )
    
    if os.path.exists(PROOF_PATH):
        logger.info(f"Proof saved to {PROOF_PATH}")
        log_resource_usage("Prove")
        
        # Optional: Verify locally
        valid = ezkl.verify(
            proof_path=str(PROOF_PATH),
            settings_path=str(SETTINGS_PATH),
            vk_path=str(VK_PATH),
            srs_path=str(SRS_PATH)
        )
        if valid:
            logger.info("✅ Proof verified locally via EZKL")
        else:
            logger.error("❌ Proof failed local verification")
    else:
        logger.error("Proof generation failed (file not created)")

if __name__ == "__main__":
    asyncio.run(main())
