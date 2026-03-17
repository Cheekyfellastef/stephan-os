export default class EnemyDive {

    constructor(formation){

        this.formation = formation;
        this.timer = 0;

    }

    update(dt){

        this.timer += dt;

        if(this.timer > 3){

            this.timer = 0;

            const enemies = this.formation.enemies;

            const randomEnemy =
                enemies[Math.floor(Math.random()*enemies.length)];

            if(randomEnemy)
                randomEnemy.diving = true;

        }

        this.formation.enemies.forEach(enemy => {

            if(enemy.diving){

                enemy.y += 120 * dt;

                enemy.x += Math.sin(enemy.y * 0.05) * 2;

                if(enemy.y > 700){

                    enemy.y = 50;
                    enemy.diving = false;

                }

            }

        });

    }

}