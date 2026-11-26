export const themeStorageKey = "my-kineshma-theme";

// A constant, synchronous head script sets the palette before the body is painted.
// Never interpolate request or publication content into this script.
export const themeBootstrap = `(function(){var t;try{t=localStorage.getItem('${themeStorageKey}')}catch(e){}if(t!=='light'&&t!=='dark')t='dark';document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#191b1f':'#eef2f5')})();`;
