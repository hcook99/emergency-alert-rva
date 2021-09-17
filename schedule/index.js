const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require("crypto");
const addDays = require('date-fns/addDays');
const subDays = require('date-fns/subDays')
const fs = require('fs');
const https = require('https');
const { Op, QueryTypes } = require("sequelize");
const { CrimeDB, sequelize } = require('./models/index');
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

function Crime(id, location, recievedAt, incident, callStatus, district, PD){
    this.id = id;
    this.location = location;
    this.recievedAt = recievedAt;
    this.incident = incident;
    this.callStatus = callStatus;
    this.district = district;
    this.PD = PD;
}

Crime.fromHenrico = function($, row) {
    const timeOfIncident = $(row[2]).text().split(':');
    const dateOfIncident = new Date();
    dateOfIncident.setHours(timeOfIncident[0], timeOfIncident[1]);
    return new Crime(
        $(row[0]).text(),
        $(row[1]).text().replace("Block ", "")+" Henrico, VA",
        dateOfIncident,
        $(row[3]).text(),
        $(row[4]).text(),
        $(row[5]).text(),
        $(row[6]).text()
    );
}

Crime.fromRichmond = function($, row) {
    let location = $(row[5]).text().replace("-BLK", "");
    return new Crime(
        $(row[5]).text()+$(row[0]).text(),
        location.substring(location.length-4,location.length)==='RICH'?location+"MOND, VA" : location+" Richmond, VA",
        new Date($(row[0]).text()),
        $(row[4]).text(),
        $(row[6]).text(),
        $(row[2]).text(),
        $(row[3]).text()
    );
}

async function getHenricoWebsiteData(){
    const response = axios.get("https://activecalls.henrico.us/");
    let data;
    try{
        data = (await response).data
    }
    catch(e){
        console.log(e);
        return;
    }
    const $ = cheerio.load(data);
    const rows = $("tbody");
    const listOfCurrentCrime = [];
    rows.find("tr").first().remove()
    rows.find("tr").map((i, row) => {
        const items = $(row).find("td");
        let crime = Crime.fromHenrico($, items);
        listOfCurrentCrime.push(crime);
    });
    return listOfCurrentCrime;
}

async function getRichmondWebsiteData(){
    const randomCookie = `NSC_bqqt-ttm-wjq=${crypto.randomBytes(44).toString('hex')}; expires=${addDays(new Date(), 1)};path=/;secure;httponly`
    const response = axios.get("https://apps.richmondgov.com/applications/activecalls/Home/ActiveCalls",  { headers: { Cookie: randomCookie }, httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
    let data;
    try{
        data = (await response).data
    }
    catch(e){
        console.log(e);
        return;
    }
    const $ = cheerio.load(data);
    const rows = $("tbody");
    const listOfCurrentCrime = [];
    rows.find("tr").map((i, row) => {
        let crime = Crime.fromRichmond($, $(row).find("td"));
        listOfCurrentCrime.push(crime);
    });
    return listOfCurrentCrime;
}

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

async function getZipcode(lat, long){
    const response = axios.get(`http://api.positionstack.com/v1/reverse?access_key=${process.env.POSITION_KEY}&query=${lat},${long}&output=json`);
    let data;
    try{
        data = (await response).data.data
    }
    catch(e){
        console.log(e.response.data);
        return;
    }
    return data[0].postal_code;
}

async function getWebsiteData(){
    await sequelize.sync({ alter: true, force: false });
    var crimes = fs.readFileSync('crimes.csv')
        .toString()
        .split(',')
        .map(crime=>crime.trim())
    const henrico = await getHenricoWebsiteData();
    const richmond = await getRichmondWebsiteData();
    let henricoAndRichmondCrime = [...henrico, ...richmond];
    henricoAndRichmondCrime = henricoAndRichmondCrime.filter(currentCrime=>crimes.some(crime=>currentCrime.incident.includes(crime)));
    for(let i =0;i<henricoAndRichmondCrime.length;i++){
        const currentCrime = await CrimeDB.findOne({where: { id: henricoAndRichmondCrime[i].id }});
        if(!currentCrime){
            let data = await convertAddressToCoordingates(henricoAndRichmondCrime[i].location);
            if(data){
                henricoAndRichmondCrime[i].longitude = data.longitude;
                henricoAndRichmondCrime[i].latitude = data.latitude;
                if(!data.zipcode){
                    henricoAndRichmondCrime[i].zipcode = await getZipcode(data.latitude,data.longitude);
                }
                else{
                    henricoAndRichmondCrime[i].zipcode = data.postal_code;
                }
            }
        }
    }
    await deleteOldCrimes();
    return henricoAndRichmondCrime;
}

async function deleteOldCrimes(){
    await CrimeDB.destroy({ where: { recievedAt: {[Op.lt]: subDays(new Date(), 1)} }});
}

function calculateDistance(long1,lat1, long2, lat2){
    const R = 3963.0
    const lat1Rad = lat1 * (Math.PI/180);
    const lat2Rad = lat2 * (Math.PI/180);
    const dlong = (long2-long1) * (Math.PI/180);
    const dlat = (lat2-lat1) * (Math.PI/180);
    const a = Math.sin(dlat/2)*Math.sin(dlat/2)+Math.cos(lat1Rad)*Math.cos(lat2Rad)*Math.sin(dlong/2)*Math.sin(dlong/2);	
  	return R*(2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

async function main() {
    const crimes = await getWebsiteData();

    await crimes.map(async (crime)=>{
        const users = await sequelize.query(
            'SELECT id, phone_num, zipcode, longitude, latitude, distance FROM users WHERE NOT EXISTS (SELECT "userId" FROM crimes WHERE crimes."userId"=users.id and crimes.id = :crimeId)',
            {
                replacements: {crimeId: crime.id},
                type: QueryTypes.SELECT
            }
        );
        await users.map((user) => {
            if(user.longitude&&user.latitude){
                if(crime.latitude&&crime.longitude){
                    const distanceFromCrime = calculateDistance(user.longitude, user.latitude, crime.longitude, crime.latitude);
                    if(distanceFromCrime<user.distance){
                        client.messages
                            .create({
                                body: `This is an alert from RVA alerts a ${crime.incident} has been reported at ${crime.location} please avoid area.`,
                                from: process.env.TWILIO_PHONE_NUM,
                                to: user.phone_num
                            }).catch(e=>console.log(e));
                        try{
                            CrimeDB.create({ id: crime.id+user.id, recievedAt: crime.recievedAt, userId: user.id }, {
                                ignoreDuplicates: true,
                            });
                        }catch(e){
                            console.log(e);
                        }
                    }
                }
            }else if(user.zipcode){
                if(crime.zipcode){
                    if(crime.zipcode === user.zipcode){
                        client.messages
                        .create({
                            body: `This is an alert from RVA alerts a ${crime.incident} has been reported at ${crime.location} please avoid area.`,
                            from: process.env.TWILIO_PHONE_NUM,
                            to: user.phone_num
                        }).catch(e=>console.log(e));
                        try{
                            CrimeDB.create({ id: crime.id+user.id, recievedAt: crime.recievedAt, userId: user.id }, {
                                ignoreDuplicates: true,
                            });
                        }catch(e){
                            console.log(e);
                        }
                    }
                }
            }
        })
        
    });
}

main();