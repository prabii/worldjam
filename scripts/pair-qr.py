"""
Displays a QR code for Android's "Pair device with QR code".

Android scans a QR the COMPUTER shows, in the format:

    WIFI:T:ADB;S:<service-name>;P:<password>;;

The phone reads it, connects back to the PC's adb over mDNS, and pairs — no
typing an IP, and no 60-second code to race.

Run this, then on the phone:
    Developer options -> Wireless debugging -> "Pair device with QR code"
"""

import os
import secrets
import string
import subprocess
import sys
import time
from pathlib import Path

import qrcode

ADB = Path(
    subprocess.run(
        ["cmd", "/c", "echo %LOCALAPPDATA%"], capture_output=True, text=True
    ).stdout.strip()
) / "Android" / "Sdk" / "platform-tools" / "adb.exe"

# The service name must start with "studio-" for some Android builds to accept
# the pairing; the suffix is arbitrary.
NAME = "studio-" + "".join(secrets.choice(string.ascii_letters) for _ in range(8))
PASSWORD = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(12))

payload = f"WIFI:T:ADB;S:{NAME};P:{PASSWORD};;"


def show_qr(data: str) -> None:
    # Windows terminals default to cp1252, which cannot encode block glyphs.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    qr = qrcode.QRCode(border=2)
    qr.add_data(data)
    qr.make(fit=True)

    # Half-block rendering: two QR rows per terminal line, so the code stays
    # square and small enough to scan off a normal terminal window.
    m = qr.get_matrix()
    if len(m) % 2:
        m.append([False] * len(m[0]))

    out = []
    for y in range(0, len(m), 2):
        line = []
        for x in range(len(m[0])):
            top, bottom = m[y][x], m[y + 1][x]
            # Inverted: QR needs dark modules on light, terminals are dark.
            if top and bottom:
                line.append(" ")
            elif top:
                line.append("▄")
            elif bottom:
                line.append("▀")
            else:
                line.append("█")
        out.append("".join(line))

    pad = "█" * (len(m[0]) + 4)
    print(pad)
    for line in out:
        print("██" + line + "██")
    print(pad)


def main() -> int:
    if not ADB.exists():
        print(f"adb not found at {ADB}", file=sys.stderr)
        return 1

    # Also write a PNG, for scanning off the screen if the terminal font
    # renders the block characters poorly.
    png = Path(__file__).resolve().parent.parent / "pair-qr.png"
    qrcode.make(payload).save(png)

    print()
    show_qr(payload)
    print()
    print("On the phone:")
    print("  Settings -> Developer options -> Wireless debugging")
    print('  -> "Pair device with QR code"  -> scan the square above')
    print()
    print(f"(A PNG is also at {png} if the terminal QR will not scan.)")
    print()
    print("Waiting for the phone to pair...")

    proc = subprocess.Popen(
        [str(ADB), "pair", f"{NAME}:{PASSWORD}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    deadline = time.time() + 180
    while time.time() < deadline:
        if proc.poll() is not None:
            print(proc.stdout.read() if proc.stdout else "")
            break
        devices = subprocess.run(
            [str(ADB), "devices"], capture_output=True, text=True
        ).stdout
        if len([l for l in devices.splitlines()[1:] if l.strip()]) > 0:
            print("\nPAIRED:")
            print(devices)
            return 0
        time.sleep(2)

    proc.terminate()
    print("\nTimed out. Re-run and scan again, or use a USB cable.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
