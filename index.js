const mqtt = require('mqtt');
const emoncms = require('emoncms');
const winston = require('winston');
const fs = require('fs');
let melcloud = require('./melcloud');
const cron = require('node-cron');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'melcloud-mqtt' },
  transports: [
    new winston.transports.File({ filename: 'melcloud-mqtt-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'melcloud-mqtt-combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

try {
  var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
}
catch (e) {
  logger.error(e);
  var config = { 'all': { 'mqtt': {}, 'influx': {} }, 'hej': {} };
}


var melcloudClient = new melcloud(config, logger);
melcloudClient.accessories(accessoriesCb);

function accessoriesCb(accessoriesList) {
  cron.schedule('* * * * *', () => {
    accessoriesList.forEach(accessory => {
      logger.info('Updating device ID: %s', accessory.id);
      melcloudClient.updateAccessory(accessory);
    });
  });
}