export default class Scaler {

    static apply(canvas, baseWidth, baseHeight){

        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        const scaleX = Math.floor(screenWidth / baseWidth);
        const scaleY = Math.floor(screenHeight / baseHeight);

        const scale = Math.max(1, Math.min(scaleX, scaleY));

        canvas.style.width = (baseWidth * scale) + "px";
        canvas.style.height = (baseHeight * scale) + "px";

    }

}