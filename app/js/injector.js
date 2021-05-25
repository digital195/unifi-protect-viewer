// This is an example of what to do when we need access to objects created by
// scripts embedded in the DOM. Keep in mind that usually we do NOT need access
// to such objects, and this sample illustrates a special case.

// Generated for script text that injects a script tag into the DOM. The script
// tag will contain the script we intend to run wrapped in an anonymous
// function. This way, the script we wish to run can access the guest page
// scripting context.
function generateScript(fn) {
	// fn is going to be interpreted as a quoted string literal. As such, we need
	// to escape double-quotes in the string, and either:
	// (a) strip newlines and comments, or
	// (b) replace newlines with the character sequence "\n" (a slash followed by
	//     an n) and allow comments to be parsed as part of the function.

	// (a):
	// var fnText = fn.toString()
	//   .replace(/"/g, '\\"')                         // Escape double-quotes.
	//   .replace(/[/][/].*\r?\n/g, ' ')               // Rmv single-line comments.
	//   .replace(/\r?\n|\r/g, ' ')                    // Rmv newlines.
	//   .replace(/[/][*]((?![*][/]).)*[*][/]/g, ' '); // Rmv multi-line comments.

	// (b):
	var fnText = fn.toString()
		.replace(/"/g, '\\"')           // Escape double-quotes.
		.replace(/(\r?\n|\r)/g, '\\n'); // Insert newlines correctly.

	var scriptText =
		'(function() {\n' +
		'  var script = document.createElement("script");\n' +
		'  script.innerHTML = "(function() { (' + fnText + ')(); })()" \n'+
		'  document.body.appendChild(script);\n' +
		'})()';
	return scriptText;
}

// When our app loads, setup a listener that will execute our script after the
// target guest page has loaded.
let first = true;
window.addEventListener('load', function() {	
	webview.addEventListener('loadstop', function() {
		console.log(webview.src);
		
		if (webview.src.includes('/login?redirect=%2Fprotect%2F')) {
			console.log('login');
			if (first) {
				console.log('first login fix cert');
				// webview.executeScript({ code: generateScript(fuckOffChrome) });
				first = false;
			}			
			
			setTimeout(function() { 
				webview.executeScript({ code: generateScript(login) });
			}, 3000); 
		}
		
		if (webview.src.includes("/liveview/")){
			setTimeout(function() {
				webview.executeScript({ code: generateScript(fullscreen) });
			}, 3000);
		}
	});
	
	webview.addEventListener('permissionrequest', function(e) {
		if (e.permission === 'fullscreen') e.request.allow();
	});

	document.addEventListener('webkitfullscreenchange', function(){
		if (chrome.app.window.current().isFullscreen()){
			webview.style.height = screen.height + 'px';
			webview.style.width = screen.width + 'px';
		}
		else{
			/*get webview to original dimensions*/
			webview.style.height = '100%';
			webview.style.width = '100%';
		};
	});
});