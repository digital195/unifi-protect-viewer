# UnifiProtect Chrome App

This is a Chrome app for Unifi Protect Live View build by remcotjeerdsma updated by Sebastian Loer. This version was testet with Unifi Protect v2.0.2 running on an UDM-Pro.

## Configuration

Example config.js:

```
const PROTECT_APP = 'http://192.168.1.1/login?redirect=%2Fprotect%2Fliveview';
const PROTECT_APP_USERNAME = 'digital195';
const PROTECT_APP_PASSWORD = '54321';
const PROTECT_APP_FULLSCREEN = false;
const PROTECT_APP_RESIZEABLE = true;
```

Rename the `config.sample.js` to `config.js` and change the values for your needs. The PROTECT_APP needs to be set to the IP-address of your Unifi Protect installation. 
Sadly with UnifiOS the not ssl encrypted port 7080 is not working with protect anymore so we need to use the encrypted 443 port. The port 7080 can work on any other device but not on the udm pro. This is testet with the following configuration `https://[IP]?redirect=%2Fprotect%2Fliveview` . Remcotjeerdsma used his approach with the not ssl encrypted 7080 port, please use that if it is possible (for performance and to avoid certificate acceptence issues for self-signed certificates, that is a problem with using the 443 port).
Leave the `/login?redirect=%2Fprotect%2Fliveview` part of the URL untouched. You can attach a direct link to a selected liveview if you want at the end of the link like so `%2F5f11fbd501b57f03870003fa` where `5f11fbd501b57f03870003fa` is the url id of the liveview.


## Installation

Zip the `app` folder, and rename the fileextension to `.crx`. Then upload the chrome app to your Chrome browser or ChromeOS. 
The app is compatible with kiosk mode on ChromeOS devices (such as ChromeBit/ChromeStick etc) so that it autostarts on boot there.

If your chrome is in developer mode, you can also upload the 'app' folder directly to your own installation without zipping.
1.  Go to `chrome://extensions/` and check the box for Developer mode in the top right.
2.  Refresh the page and click the 'Load unpacked extension' button and select the `app` folder to install it.


## Source

This Chrome app is based on the UnifiProtectCrx from [remcotjeerdsma](https://github.com/remcotjeerdsma/UnifiProtectCrx)