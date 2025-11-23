# AGENTS.md

## EZKL Setup Quirks & Patterns

### 1. Async Python Bindings
- Many EZKL functions (`get_srs`, `create_evm_verifier`) are async in Python.
- **Quirk:** They throw `RuntimeError: no running event loop` if called synchronously.
- **Pattern:** Wrap calls in `asyncio.run(main())`.

### 2. Setup Arguments
- The `ezkl.setup()` function signature in Python bindings can vary by version.
- **Quirk:** Some docs say `compiled_circuit`, others imply positional args.
- **Pattern:** Use `model=str(path)` for the compiled circuit path if named args fail, or check specific version docs.

### 3. Input Shape Inference
- **Pattern:** Using `onnx.load` to inspect `model.graph.input[0]` is reliable for auto-generating calibration data.
- **Quirk:** Dynamic axes (dim value 0 or -1) need manual handling (defaulting to 1 is usually safe for batch size).

### 4. Memory Management
- **Quirk:** Large circuits (high logrows) consume massive RAM during compilation and key generation.
- **Pattern:** Monitor `resource.getrusage` to prevent OOM kills on smaller instances.
