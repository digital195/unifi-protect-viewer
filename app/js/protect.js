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
	
	console.log('LOGIN');
	
	setNativeValue(document.getElementsByName('username')[0], username);
	setNativeValue(document.getElementsByName('password')[0], password);

	document.getElementsByTagName('button')[0].click();
}

function fullscreen() {
	var header = document.getElementsByTagName('header')[0];
	header.style.display = 'none';

	var menubar = document.getElementsByTagName('nav')[0];
	menubar.style.display = 'none';

	var liveview = document.querySelectorAll("[class^=liveview__ViewportsWrapper]")[0];
	liveview.style.maxWidth = '100vw';
	liveview.style.maxHeight = '100vh';
}

function changeControls() {
	var controlsBox = document.querySelectorAll("[class^=LiveviewControls__ControlsBox]")[0];
	
	controlsBox.childNodes[0].style.display = 'none';
	
	var changeControlRoot = document.querySelectorAll("[class^=LiveviewChangeControl__Root]")[0];
	
	changeControlRoot.addEventListener("click", function() {
		setTimeout(function() {
			var addNewContainer = document.querySelectorAll("[class^=LiveviewChangeControl__AddNewContainer]")[0];
		
			addNewContainer.style.display = 'none';
		}, 100);
	});
}

window.addEventListener('resize', () => {
  let vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
});

function fuckOffChrome() {
	document.getElementById('details-button').click();

	document.getElementById('proceed-link').click();	
}
