"""Test-suite compatibility helpers."""

import sys


if sys.platform == "win32":
    from gltest.direct import loader

    _inject_message_to_fd0 = loader._inject_message_to_fd0

    def _inject_message_to_fd0_windows(vm):
        """Tolerate gltest unlinking its still-open stdin file on Windows."""
        try:
            _inject_message_to_fd0(vm)
        except PermissionError:
            # The message is already written and attached to fd 0. Windows does
            # not allow the harness to unlink that open temporary file here.
            return

    loader._inject_message_to_fd0 = _inject_message_to_fd0_windows

