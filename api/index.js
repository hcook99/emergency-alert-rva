const http = require('http');
const express = require('express');
const axios = require('axios')
const session = require('express-session');
const { urlencoded, json } = require('body-parser');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { UserDB } = require('./models/index');

const app = express();

app.use(urlencoded());
app.use(json());
app.use(session({secret: process.env.SESSION_SECRET}));

const asyncWrapper = (fn) => {
    return function (req, res, next) {
        fn(req, res, next)
          .catch(next)
      }
};

async function convertAddressToCoordingates(address) {
    const response = axios.get(`http://api.positionstack.com/v1/forward?access_key=${process.env.POSITION_KEY}&query=${address}&output=json`);
    let data;
    try{
        data = (await response).data.data
    }
    catch(e){
        console.log(e.response.data);
        return;
    }
    return data[0];
}

app.post('/', asyncWrapper(async (req, res) => {
    const smsCount = req.session.counter || 0;

    let message;

    const user = await UserDB.findOne({where:{phone_num: req.body.From}});

    if(!user){
        if(smsCount==0){
            message = "Welcome to RVA alerts would you like to be added to alerts?(text yes or Y to be added)";
        }
        else{
            if(req.body.Body.toLowerCase()==='yes'||req.body.Body.toLowerCase()==='y'){
                await UserDB.create({ phone_num: req.body.From });
                message = "Thank you! Now to add your address if you don't feel comfortable with that we can just use your zip code."
            }
        }
    }
    else{
        if(!user.zipcode&&(!user.longitude||!user.latitude)){
            const address = await convertAddressToCoordingates(req.body.Body);
            if(address){
                if(address.type==='address'){
                    user.longitude=address.longitude;
                    user.latitude=address.latitude;
                    await user.save();
                    message="Thanks your address has been saved.";
                }
                else if(address.type==='postalcode'){
                    user.zipcode = address.postal_code;
                    await user.save();
                    message="Thanks your zipcode has been saved";
                }
                else{
                    message="Sorry invalid entry. Try again.";
                }
            }
            else{
                message="Sorry invalid entry. Try again.";
            }
        }
        else{
            if(req.body.Body==='1'){
                message = "Thanks send us your new addess.";
                req.session.option='1';
            }
            else if(req.body.Body==='2'){
                message = "Thanks send us the distance around your house you want to alerted of(miles).";
                req.session.option='2';
            }
            else if(req.body.Body==='3'){
                await user.destroy();
            }
            else{
                if(req.session.option==='1'){
                    const address = await convertAddressToCoordingates(req.body.Body);
                    if(address){
                        if(address.type==='address'){
                            user.longitude=address.longitude;
                            user.latitude=address.latitude;
                            user.zipcode=null;
                            await user.save();
                            req.session.option='0';
                            message="Thanks your prefrences have been changed.";
                        }
                        else if(address.type==='postalcode'){
                            user.zipcode = address.postal_code;
                            user.latitude=null;
                            user.longitude=null;
                            await user.save();
                            req.session.option='0';
                            message="Thanks your prefrences have been changed.";
                        }
                        else{
                            message="Sorry invalid entry. Try again.";
                        }
                    } 
                }
                else if(req.session.option==='2'){
                    const numSent = parseInt(req.body.Body);
                    if(numSent===NaN){
                        message="Sorry invalid entry. Try again."
                    }
                    else{
                        user.distance = numSent;
                        await user.save();
                        req.session.option='0';
                        message="Thanks your prefrences have been changed";
                    }
                }
                else{
                    message="What can I help you with. To change address text 1. To change distance in miles of alerts text 2. To be removed from alerts press 3.";
                }
            }
        }
    }

    req.session.counter = smsCount + 1;

    const twiml = new MessagingResponse();
    twiml.message(message);

    res.writeHead(200, {'Content-Type': 'text/xml'});
    res.end(twiml.toString());
}));

http.createServer(app).listen(4000, () => {
    console.log('Express server listening on port 4000');
});