/**
 * Listens for the app launching then creates the window
 *
 * @see http://developer.chrome.com/apps/app.runtime.html
 * @see http://developer.chrome.com/apps/app.window.html
 */
chrome.app.runtime.onLaunched.addListener(function() {
  runApp();
});

/**
 * Listens for the app restarting then re-creates the window.
 *
 * @see http://developer.chrome.com/apps/app.runtime.html
 */
chrome.app.runtime.onRestarted.addListener(function() {
  runApp();
});

/**
 * Creates the window for the application.
 *
 * @see http://developer.chrome.com/apps/app.window.html
 */
function runApp() {	
	const state = PROTECT_APP_FULLSCREEN ? 'fullscreen' : 'normal';
	
	chrome.app.window.create('html/protect.html', {'id': 'unifiProtectViewer', state: state, 'resizable': PROTECT_APP_RESIZEABLE},
		function(createdWindow) {
			if (PROTECT_APP_FULLSCREEN) {
				createdWindow.fullscreen();
			}
		}
	);
}
