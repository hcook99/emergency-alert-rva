module.exports = (sequelize, Sequelize) => {
    const Crime = sequelize.define("crime", {
        id: {
            type: Sequelize.STRING,
            primaryKey: true
        },
        recievedAt: {
            type: Sequelize.DATE
        }
    });
    return Crime;
}