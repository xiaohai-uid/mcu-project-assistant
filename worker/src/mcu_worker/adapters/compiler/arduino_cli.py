"""ArduinoCLICompiler: validates firmware via real arduino-cli compile.

Security:
- Uses subprocess with argument list (NO shell=True)
- Each run gets an isolated temp workspace
- Compile has a timeout; timeout kills the subprocess
- Workspace is cleaned up after compile
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

from mcu_worker.domain.models.compile_result import CompileDiagnostic, CompileResult


class ArduinoCLICompiler:
    """Compiles Arduino sketches using arduino-cli.

    Usage:
        compiler = ArduinoCLICompiler(fqbn="arduino:avr:uno")
        result = compiler.compile(source_code, libraries=["DHT sensor library"])
    """

    def __init__(
        self,
        fqbn: str = "arduino:avr:uno",
        timeout_seconds: int = 120,
        cli_path: str = "arduino-cli",
    ) -> None:
        self._fqbn = fqbn
        self._timeout = timeout_seconds
        self._cli_path = cli_path

    def compile(
        self,
        source_code: str,
        libraries: list[str] | None = None,
        sketch_name: str = "sketch",
    ) -> CompileResult:
        """Compile source code in an isolated workspace.

        Args:
            source_code: Complete .ino sketch content.
            libraries: Arduino library names to install before compile.
            sketch_name: Name for the sketch directory/file.

        Returns:
            CompileResult with success/failure and diagnostics.
        """
        workspace = tempfile.mkdtemp(prefix=f"mcu_compile_{sketch_name}_")
        workspace_path = Path(workspace)
        sketch_dir = workspace_path / sketch_name
        sketch_dir.mkdir()
        sketch_file = sketch_dir / f"{sketch_name}.ino"
        sketch_file.write_text(source_code, encoding="utf-8")

        start_time = time.monotonic()

        try:
            # Install libraries if needed
            if libraries:
                for lib in libraries:
                    self._run_command(
                        [self._cli_path, "lib", "install", lib],
                        timeout=60,
                    )

            # Compile
            cmd = [
                self._cli_path, "compile",
                "--fqbn", self._fqbn,
                str(sketch_dir),
            ]
            proc = self._run_command(cmd, timeout=self._timeout)
            duration_ms = int((time.monotonic() - start_time) * 1000)

            success = proc.returncode == 0
            diagnostics = self._parse_diagnostics(proc.stderr) if not success else []

            return CompileResult(
                compiler="arduino-cli",
                compiler_version=self._get_version(),
                fqbn=self._fqbn,
                success=success,
                exit_code=proc.returncode,
                duration_ms=duration_ms,
                stdout_excerpt=proc.stdout[:2000] if proc.stdout else "",
                stderr_excerpt=proc.stderr[:2000] if proc.stderr else "",
                diagnostics=diagnostics,
            )

        except subprocess.TimeoutExpired:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            return CompileResult(
                compiler="arduino-cli",
                fqbn=self._fqbn,
                success=False,
                exit_code=-1,
                duration_ms=duration_ms,
                stderr_excerpt=f"Compile timed out after {self._timeout}s",
                diagnostics=[CompileDiagnostic(
                    code="TIMEOUT",
                    message=f"Compilation exceeded {self._timeout}s limit",
                    category="error",
                )],
            )
        except FileNotFoundError:
            return CompileResult(
                compiler="arduino-cli",
                fqbn=self._fqbn,
                success=False,
                exit_code=-1,
                duration_ms=0,
                stderr_excerpt="arduino-cli not found in PATH",
                diagnostics=[CompileDiagnostic(
                    code="CLI_NOT_FOUND",
                    message="arduino-cli binary not found",
                    category="error",
                )],
            )
        finally:
            # Cleanup workspace
            import shutil
            shutil.rmtree(workspace, ignore_errors=True)

    def _run_command(
        self, cmd: list[str], timeout: int
    ) -> subprocess.CompletedProcess:
        """Run a command with argument list (no shell=True)."""
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,  # SECURITY: never shell=True
        )

    def _get_version(self) -> str:
        try:
            proc = self._run_command([self._cli_path, "version"], timeout=10)
            return proc.stdout.strip().split("\n")[0] if proc.stdout else "unknown"
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return "unknown"

    def _parse_diagnostics(self, stderr: str) -> list[CompileDiagnostic]:
        """Parse compiler errors from stderr."""
        diagnostics = []
        if not stderr:
            return diagnostics

        for line in stderr.split("\n"):
            line = line.strip()
            if "error:" in line.lower():
                # Try to extract file:line:col: message
                parts = line.split(":", 3)
                if len(parts) >= 4:
                    diagnostics.append(CompileDiagnostic(
                        code="compile_error",
                        file=parts[0].strip(),
                        line=int(parts[1]) if parts[1].strip().isdigit() else None,
                        column=int(parts[2]) if parts[2].strip().isdigit() else None,
                        message=parts[3].strip(),
                        category="error",
                    ))
                else:
                    diagnostics.append(CompileDiagnostic(
                        code="compile_error",
                        message=line,
                        category="error",
                    ))

        return diagnostics[:20]  # Cap at 20 diagnostics
