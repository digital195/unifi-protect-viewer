const {contextBridge, ipcRenderer} = require('electron')


// event listeners
addEventListener('load', () => {
    run().then();
}, {once: true});

addEventListener('keydown', async (event) => {
    if (event.key === 'F9') {
        ipcRenderer.send('restart');
    }
    if (event.key === 'F10') {
        ipcRenderer.send('reset');
        ipcRenderer.send('restart');
    }
});


// electron events
const reset = () => ipcRenderer.send('reset');
const restart = () => ipcRenderer.send('restart');
const configSave = (config) => ipcRenderer.send('configSave', config);

const configLoad = () => ipcRenderer.invoke('configLoad');

contextBridge.exposeInMainWorld('electronAPI', {
    reset: () => reset(),
    restart: () => restart(),
    configSave: (config) => configSave(config),

    configLoad: () => configLoad(),
})


// handle fnc
async function handleLogin() {
    // wait until login button is present
    await waitUntil(() => document.getElementsByTagName('button').length > 0);

    const config = await configLoad();

    setNativeValue(document.getElementsByName('username')[0], config.username);
    setNativeValue(document.getElementsByName('password')[0], config.password);

    clickElement(document.getElementsByTagName('button')[0]);
}

async function handleLiveviewV2() {
    // wait until liveview is present
    await waitUntil(() => document.querySelectorAll("[class^=liveview__ViewportsWrapper]").length > 0);

    // close all modals if needed
    if (hasElements(document.getElementsByClassName('ReactModalPortal'))) {
        Array.from(document.getElementsByClassName('ReactModalPortal')).forEach(modalPortal => {
            if (elementExists(modalPortal.getElementsByTagName('svg'), 0)) {
                clickElement(modalPortal.getElementsByTagName('svg')[0]);
            }
        });
    }

    // wait until modals are closed
    await waitUntil(() => Array.from(document.getElementsByClassName('ReactModalPortal')).map(e => e.children.length === 0).filter(e => e === false).length === 0);

    setStyle(document.getElementsByTagName('header')[0], 'display', 'none');
    setStyle(document.getElementsByTagName('nav')[0], 'display', 'none');
    setStyle(document.querySelectorAll("[class^=liveview__ViewportsWrapper]")[0], 'maxWidth', '100vw');
    setStyle(document.querySelectorAll("[class^=liveview__ViewportsWrapper]")[0], 'maxHeight', '100vh');
}

async function handleLiveviewV3() {
    // wait until liveview is present
    await waitUntil(() => document.querySelectorAll("[class^=dashboard__LiveViewWrapper]").length > 0);

    // close all modals if needed
    if (hasElements(document.getElementsByClassName('ReactModalPortal'))) {
        Array.from(document.getElementsByClassName('ReactModalPortal')).forEach(modalPortal => {
            if (elementExists(modalPortal.getElementsByTagName('svg'), 0)) {
                clickElement(modalPortal.getElementsByTagName('svg')[0]);
            }
        });
    }

    // wait until modals are closed
    await waitUntil(() => Array.from(document.getElementsByClassName('ReactModalPortal')).map(e => e.children.length === 0).filter(e => e === false).length === 0);

    setStyle(document.getElementsByTagName('body')[0], 'background', 'black');
    setStyle(document.getElementsByTagName('header')[0], 'display', 'none');
    setStyle(document.getElementsByTagName('nav')[0], 'display', 'none');

    // wait until widgets are present
    await waitUntil(() =>
        hasElements(document.querySelectorAll("[class^=dashboard__Widgets]")) &&
        hasElements(document.querySelectorAll("[class^=liveView__Header]")) &&
        hasElements(document.querySelectorAll("[class^=dashboard__ExpandButton]"))
    );

    setStyle(document.querySelectorAll("[class^=dashboard__Widgets]")[0], 'display', 'none');
    setStyle(document.querySelectorAll("[class^=liveView__Header]")[0], 'display', 'none');
    setStyle(document.querySelectorAll("button[class^=dashboard__ExpandButton]")[0], 'display', 'none');
    setStyle(document.querySelectorAll("[class^=dashboard__Content]")[0], 'display', 'block');
    setStyle(document.querySelectorAll("[class^=dashboard__Content]")[0], 'padding', '0');
    setStyle(
        document.querySelectorAll("[class^=dashboard__LiveViewWrapper]")[0]
            .querySelectorAll("[class^=dashboard__Scrollable]")[0],
        'paddingBottom', '0'
    );
    setStyle(
        document.querySelectorAll("[class^=dashboard__LiveViewWrapper]")[0]
            .querySelectorAll("[class^=liveview__ViewportsWrapper]")[0],
        'maxWidth', 'calc(177.778vh - 50px)'
    );

    // wait until camera names are present
    await waitUntil(() => document.querySelectorAll("[class^=LiveViewGridSlot__CameraNameWrapper] button").length > 0);

    document.querySelectorAll("[class^=LiveViewGridSlot__CameraNameWrapper] button").forEach(button => {
        setStyle(button, 'color', 'white');
        setStyle(button, 'cursor', 'initial');
        setStyle(button, 'pointerEvents', 'none');
    });
}

async function handleLiveviewV4andV5() {
    // wait until liveview is present
    await waitUntil(() => document.querySelectorAll("[class^=liveView__FullscreenWrapper]").length > 0);

    // close all modals if needed
    if (hasElements(document.getElementsByClassName('ReactModalPortal'))) {
        Array.from(document.getElementsByClassName('ReactModalPortal')).forEach(modalPortal => {
            if (elementExists(modalPortal.getElementsByTagName('svg'), 0)) {
                clickElement(modalPortal.getElementsByTagName('svg')[0]);
            }
        });
    }

    // wait until modals are closed
    await waitUntil(() => Array.from(document.getElementsByClassName('ReactModalPortal')).map(e => e.children.length === 0).filter(e => e === false).length === 0);

    setStyle(document.getElementsByTagName('body')[0], 'background', 'black');
    setStyle(document.getElementsByTagName('header')[0], 'display', 'none');
    setStyle(document.getElementsByTagName('nav')[0], 'display', 'none');


    setStyle(document.querySelectorAll("[class^=dashboard__Widgets]")[0], 'display', 'none');
    setStyle(document.querySelectorAll("button[class^=dashboard__ExpandButton]")[0], 'display', 'none');
    setStyle(document.querySelectorAll("[class^=dashboard__Content]")[0], 'display', 'block');
    setStyle(document.querySelectorAll("[class^=dashboard__Content]")[0], 'padding', '0');
    setStyle(document.querySelectorAll("[class^=liveView__FullscreenWrapper]")[0], 'background-color', 'black');
    setStyle(
        document.querySelectorAll("[class^=liveView__LiveViewWrapper]")[0]
            .querySelectorAll("[class^=common__Widget]")[0],
        'border', '0'
    );
    setStyle(
        document.querySelectorAll("[class^=liveView__LiveViewWrapper]")[0]
            .querySelectorAll("[class^=dashboard__Scrollable]")[0],
        'paddingBottom', '0'
    );
    setStyle(
        document.querySelectorAll("[class^=liveView__LiveViewWrapper]")[0]
            .querySelectorAll("[class^=liveview__ViewportsWrapper]")[0],
        'maxWidth', 'calc((100vh) * 1.7777777777777777)'
    );

    // wait until remove option buttons are visible
    await waitUntil(() => document.querySelectorAll("[data-testid=\"option\"]").length > 0);

    document.querySelectorAll("[data-testid=\"option\"]").forEach( button => {
        setStyle(button, 'display', 'none');
    });

    // wait until camera player options are visible, then remove "Go to Timeline" Button
    await waitUntil(() => document.querySelectorAll("[class^=LiveViewGridSlot__PlayerOptions] [class^=LiveViewGridSlot__StyledGoToButton]").length > 0);

    document.querySelectorAll("[class^=LiveViewGridSlot__PlayerOptions] [class^=LiveViewGridSlot__StyledGoToButton]").forEach( button => {
    	setStyle(button, 'display', 'none');
    });

    // color all missing or error cameras black
    document.querySelectorAll("[class^=ViewportError__Wrapper]").forEach( button => {
    	setStyle(button, 'background-color', 'black');
    });
}


// logic
async function run() {
    const config = await configLoad();

    // config/ start page
    if (checkUrl('index.html') || checkUrl('config.html'))
        return;

    if (!checkUrl(config.url)) {
        window.location.href = config.url;
    }

    // wait until unifi loading screen visible, timeout 3000
    await waitUntil(() => document.querySelectorAll("[data-testid=\"loader-screen\"]").length > 0, 1000);

    // wait until unifi loading screen is gone
    await waitUntil(() => document.querySelectorAll("[data-testid=\"loader-screen\"]").length === 0);

    // unifi stuff - login
    if (checkUrl('login')) {
        await handleLogin();

        await waitUntil(() => !checkUrl('login'));
    }

    // unifi stuff - fullscreen for live view (version 2)
    if (checkUrl('protect/liveview')) {
        await handleLiveviewV2();

        console.log('version', 'Protect 2.x');

        // v2 is finished!
        return;
    }

    // wait until unifi version is visible (for v4), timeout 10000
    await waitUntil(() => document.querySelectorAll("[class^=Version__Item] > span").length > 0, 10000);

    // get version from screen (v4 has version string, v3 has not)
    const version = Array.from(document.querySelectorAll("[class^=Version__Item] > span")).filter(el => el.innerText.includes('Protect')).at(0)?.innerHTML ?? 'Protect 3.x';
    console.log('version', version);

    // unifi stuff - fullscreen for dashboard (version 3)
    if (checkUrl('protect/dashboard') && version.includes('3.')) {
        await handleLiveviewV3();

        await wait(4000);

        await handleLiveviewV3();
    }

    // unifi stuff - fullscreen for dashboard (version 4)
    if (checkUrl('protect/dashboard') && (version.includes('4.') || version.includes('5.'))) {
        await handleLiveviewV4andV5();

        await wait(4000);

        await handleLiveviewV4andV5();
    }

    // reload & login when token expires (v3 & v4) and we got the expires at in localstorage
    if (localStorage.getItem('portal:localSessionsExpiresAt')) {
        const loginExpiresAt = +localStorage.getItem('portal:localSessionsExpiresAt');

        // offset 10 minutes before expire
        const offset = 10 * 60 * 1000;

        // wait until ~10 minutes before expire or page url changed
        await waitUntil(() => !checkUrl(config.url) || new Date().getTime() > (loginExpiresAt - offset), -1, 60000);

        location.reload();
    }
}


// fnc stuff
async function wait(amount) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, amount);
    });
}

async function waitUntil(condition, timeout = 60000, interval = 100) {
    return new Promise((resolve) => {
        function complete(result) {
            timeoutAd ? clearTimeout(timeoutAd) : {};
            intervalAd ? clearInterval(intervalAd) : {};

            setTimeout(() => {
                resolve(result);
            }, 20);
        }

        const timeoutAd = timeout !== -1 ? setTimeout(() => {
            complete(false);
        }, timeout) : undefined;

        const intervalAd = setInterval(() => {
            if (condition()) {
                complete(true);
            }
        }, interval);
    });
}

function setNativeValue(element, value) {
    if (!element)
        return;

    const lastValue = element.value;
    element.value = value;
    const event = new Event("input", {target: element, bubbles: true});

    event.simulated = true;

    // React 16
    const tracker = element._valueTracker;
    if (tracker) {
        tracker.setValue(lastValue);
    }
    element.dispatchEvent(event);
}

function clickElement(element) {
    if (!element)
        return;

    if (element.click) {
        element.click();
    } else {
        const event = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });

        element.dispatchEvent(event);
    }
}

function setStyle(element, style, value) {
    if (!element)
        return;

    element.style[style] = value;
}

function elementExists(elements, index = 0) {
    return elements.length > 0 && elements[index];
}

function hasElements(elements) {
    return elements.length > 0;
}

function checkUrl(urlPart) {
    return document.URL.includes(urlPart);
}
