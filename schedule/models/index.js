const Sequelize = require('sequelize');
const CrimeModel = require('./Crimes');
const UserModel = require('./User');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect:  'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    }
});

const CrimeDB = CrimeModel(sequelize, Sequelize);
const UserDB = UserModel(sequelize, Sequelize);

UserDB.hasMany(CrimeDB);
CrimeDB.belongsTo(UserDB);

module.exports = {
    CrimeDB, UserDB, sequelize
}