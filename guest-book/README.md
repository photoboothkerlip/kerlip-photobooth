# Kerlip Digital Guest Book

Requires Node.js 24. No package installation is needed.

From the `guest-book` folder, run:

    node server.mjs

Open http://localhost:8787/crew and sign in with the password printed on first startup. To set a new password, stop the server, run `$env:KERLIP_PASSWORD = 'your-new-password'` in PowerShell, then start the server again. Keep the terminal open while using the app.

## Try the Annual Dinner demo

1. Open **Annual Dinner** in the crew dashboard. Copy the guest tablet and organiser links from Event setup. The demo album PIN is **2468**.
2. Upload a booth photo, then open the guest link. Select the photo, add a name and message, and sign.
3. Open the organiser link and enter the PIN. Download the PDF. Back in the crew dashboard, refresh entries and hide the test entry. The album updates within a few seconds and the next PDF excludes the hidden entry.

## Use at an event

Create a fresh event with its own PIN. On the laptop, open the **Same Wi-Fi** address printed in the terminal, then copy the guest and organiser links from that address so they work on other devices. Keep the host and tablet on the same trusted network. The organiser can download the PDF while connected to that network and keep it for later.

The server stores event data in `data/guestbook.sqlite`. Stop the server before backing up the entire `data` folder. This build serves local HTTP. The laptop must stay on for the album links to work, and the links require access to the laptop's network.
