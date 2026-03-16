export default class Collision {

    static check(a, b){

        return (
            a.x - a.width/2 < b.x + b.width/2 &&
            a.x + a.width/2 > b.x - b.width/2 &&
            a.y - a.height/2 < b.y + b.height/2 &&
            a.y + a.height/2 > b.y - b.height/2
        )
    }
}