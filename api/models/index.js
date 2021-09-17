const Sequelize = require('sequelize');
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

const UserDB = UserModel(sequelize, Sequelize);

sequelize.sync({ alter: true, force: false })
  .then(() => {
    console.log(`Database & tables created!`)
})

module.exports = {
    UserDB
}