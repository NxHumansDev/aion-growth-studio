import subprocess
import sys

# Revertir todos los archivos a su estado original
result = subprocess.run(['git', 'checkout', 'HEAD', '--', '.'], cwd='/vercel/share/v0-project', capture_output=True, text=True)

if result.returncode == 0:
    print("✓ Todos los archivos han sido revertidos a su estado original")
else:
    print(f"Error: {result.stderr}")
    sys.exit(1)
