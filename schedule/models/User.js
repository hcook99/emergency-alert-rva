module.exports = (sequelize, Sequelize) => {
    const User = sequelize.define("user", {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        phone_num: {
            type: Sequelize.STRING
        },
        zipcode: {
            type: Sequelize.STRING
        },
        longitude: {
            type: Sequelize.REAL
        },
        latitude: {
            type: Sequelize.REAL
        },
        distance: {
            type: Sequelize.INTEGER,
            defaultValue: 5
        }
    });
    return User;
}