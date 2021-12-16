function login() {
	function setNativeValue(element, value) {
		const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
		const prototype = Object.getPrototypeOf(element);
		const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

		if (valueSetter && valueSetter !== prototypeValueSetter) {
			prototypeValueSetter.call(element, value);
		} else {
			valueSetter.call(element, value);
		}
		element.dispatchEvent(new Event('input', { bubbles: true }));
	}
	
	setNativeValue(document.getElementsByName('username')[0], 'addMe');
	setNativeValue(document.getElementsByName('password')[0], 'addMe');
	document.getElementsByTagName('button')[0].click();
}

function fullscreen() {
	var header = document.getElementsByTagName('header')[0];
	// header.parentNode.removeChild(header);
	header.style.display = 'none';

	var settingsbar = document.getElementsByTagName('section')[0].children[0]
	// settingsbar.parentNode.removeChild(settingsbar);
	// settingsbar.style.display = 'none';

	var menubar = document.getElementsByTagName('nav')[0];
	// menubar.parentNode.removeChild(menubar);
	menubar.style.display = 'none';

	var liveview = document.querySelectorAll("[class^=liveview__ViewportsWrapper]")[0];
	liveview.style.maxWidth = '100vw';
	liveview.style.maxHeight = '100vh';
}

function fuckOffChrome() {
	document.getElementById('details-button').click();

	document.getElementById('proceed-link').click();	
}
