/** Runs in <head> before paint: saved choice, else the system setting. */
export const THEME_INIT = `try{var t=localStorage.getItem("hf-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;
