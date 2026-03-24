export default class Scaler {

    static apply(canvas, baseWidth, baseHeight){

        const parentRect = canvas.parentElement?.getBoundingClientRect();
        const viewport = window.visualViewport;

        const screenWidth = parentRect?.width ?? viewport?.width ?? window.innerWidth;
        const screenHeight = parentRect?.height ?? viewport?.height ?? window.innerHeight;

        const rawScale = Math.min(screenWidth / baseWidth, screenHeight / baseHeight);
        const scale = rawScale >= 1 ? Math.max(1, Math.floor(rawScale)) : Math.max(0.1, rawScale);

        canvas.style.width = `${baseWidth * scale}px`;
        canvas.style.height = `${baseHeight * scale}px`;

    }

}
