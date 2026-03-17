#!/usr/bin/env python3
import subprocess
import sys
import os

# Cambiar al directorio del proyecto (directorio actual del cwd)
os.chdir(os.getcwd())

# Ejecutar git checkout para revertir todos los archivos
result = subprocess.run(['git', 'checkout', '.'], capture_output=True, text=True)

print("[v0] Git checkout iniciado...")
print(result.stdout)
if result.stderr:
    print("[v0] Output:")
    print(result.stderr)

if result.returncode == 0:
    print("[v0] ✓ Todos los archivos han sido revertidos a su estado original")
else:
    print(f"[v0] Error code: {result.returncode}")


