'use strict';

const request = require('request');
const _ = require('underscore');
const emonCms = require('emoncms');
const mqtt = require('mqtt');

function Melcloud(config, log) {
  this.log = log;
  this.language = config["language"];
  this.username = config["username"];
  this.password = config["password"];
  this.mqtt = config["mqtt"];
  if (this.mqtt.host) {
    var options = {
      clientId: this.mqtt.clientId,
      username: this.mqtt.username,
      password: this.mqtt.password,
      clean: true
    }
    try {
      this.mqttClient = mqtt.connect('mqtt://' + this.mqtt.host, options);
    } catch (e) {
      this.log.error('Error connecting to MQTT');
      this.log.error(e);
    }
  }
  this.emonCms = config["emonCms"];
  if (this.emonCms.apiKey && this.emonCms.url) {
    this.emonCmsClient = new emonCms(this.emonCms.apiKey, this.emonCms.url);
    this.emonCmsClient.datatype = this.emonCms.dataType;
  }
  this.ContextKey = null;
  this.UseFahrenheit = null;
  this.currentAirInfoExecution = 0;
  this.airInfoExecutionPending = [];
}

Melcloud.prototype = {
  test: function () {
    console.log("TEST");
  },
  accessories: function (callback) {
    this.log.info("Fetching Melcloud devices...");
    var that = this;
    // Login
    var url = "https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin";
    var form = {
      AppVersion: "1.9.3.0",
      CaptchaChallenge: "",
      CaptchaResponse: "",
      Email: this.username,
      Language: this.language,
      Password: this.password,
      Persist: "true"
    };
    var method = "post";
    var that = this;
    request({
      url: url,
      form: form,
      method: method
    }, function (err, response) {
      if (err) {
        that.log.error("There was a problem sending login to: " + url);
        that.log.error(err);
        callback([]);
      } else {
        var r = eval("(" + response.body + ")");
        that.ContextKey = r.LoginData.ContextKey;
        that.UseFahrenheit = r.LoginData.UseFahrenheit;
        that.log.info("ContextKey: " + that.ContextKey);
        that.getDevices(callback);
      }
    });
  },
  getDevices: function (callback) {
    var url = "https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices";
    var method = "get";
    var that = this;
    request({
      url: url,
      method: method,
      headers: {
        "X-MitsContextKey": this.ContextKey
      }
    }, function (err, response) {
      if (err) {
        that.log("There was a problem getting devices from: " + url);
        that.log(err);
      } else {
        var r = eval("(" + response.body + ")");
        var foundAccessories = [];
        for (var b = 0; b < r.length; b++) {
          var building = r[b];
          var devices = building.Structure.Devices;
          that.createAccessories(building, devices, foundAccessories);
          for (var f = 0; f < building.Structure.Floors.length; f++) {
            var devices = building.Structure.Floors[f].Devices;
            that.createAccessories(building, devices, foundAccessories);
            for (var a = 0; a < building.Structure.Floors[f].Areas.length; a++) {
              var devices = building.Structure.Floors[f].Areas[a].Devices;
              that.createAccessories(building, devices, foundAccessories);
            }
          }
          for (var a = 0; a < building.Structure.Areas.length; a++) {
            var devices = building.Structure.Areas[a].Devices;
            that.createAccessories(building, devices, foundAccessories);
          }
        }
        callback(foundAccessories);
      }
    });
  },
  createAccessories: function (building, devices, foundAccessories) {
    for (var d = 0; d < devices.length; d++) {
      var device = devices[d];
      var accessory = new Object();
      //accessory.remoteAccessory = device;
      accessory.id = device.DeviceID;
      accessory.name = device.DeviceName;
      accessory.model = "";
      accessory.manufacturer = "Mitsubishi";
      accessory.serialNumber = device.SerialNumber;
      accessory.buildingId = building.ID;
      accessory.roomTemperature = device.Device.RoomTemperature;
      accessory.setTempetarute = device.Device.SetTemperature;
      accessory.actualFanSpeed = device.Device.ActualFanSpeed;
      accessory.operationMode = MelcloudOperationModes[device.Device.OperationMode];
      accessory.operationModeNumeric = device.Device.OperationMode;
      accessory.currentEnergyConsumed = device.Device.CurrentEnergyConsumed;
      accessory.hasErrorMEssages = device.Device.HasErrorMessages;
      this.postData(accessory);
      foundAccessories.push(accessory);
    }
  },
  updateAccessory: function (accessory) {
    if (this.ContextKey) {
      var that = this;
      var url = "https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/Get";
      var form = {
        id: accessory.id,
        buildingID: accessory.buildingId
      };
      var method = "get";
      var that = this;
      request({
        url: url,
        form: form,
        method: method,
        headers: {
          "X-MitsContextKey": this.ContextKey
        }
      }, function (err, response) {
        if (err) {
          that.log.error("There was a problem getting device: " + url);
          that.log.error(err);
          callback([]);
        } else {
          var r = eval("(" + response.body + ")");
          
          accessory.roomTemperature = r.RoomTemperature;
          accessory.setTempetarute = r.SetTemperature;
          accessory.actualFanSpeed = r.ActualFanSpeed;
          accessory.operationMode = MelcloudOperationModes[r.OperationMode];
          accessory.operationModeNumeric = r.OperationMode;
          accessory.currentEnergyConsumed = r.CurrentEnergyConsumed;
          accessory.hasErrorMEssages = r.HasErrorMessages;
          that.postData(accessory);
        }
      });
    }
  },
  postData(accessory) {
    if (this.mqttClient)
      this.log.info('Posting to MQTT');
      this.postMqtt(accessory);
    
    if (this.emonCmsClient)
      this.log.info('Posting to EmonCMS');
      this.postEmonCms(accessory);
  },
  postMqtt(accessory) {
    this.mqttClient.publish(this.mqtt.mainTopic + '/' + accessory.buildingId + '/' + accessory.id, JSON.stringify(accessory));
  }, 
  postEmonCms(accessory) {
    this.emonCmsClient.nodegroup = this.emonCms.nodeGroupPrefix + accessory.id;
    var emonObj = {
      payload: accessory
    };

    this.emonCmsClient.post(emonObj).catch(function (err) {

      this.log.error('Error posting to EmonCMS');
      this.log.error(err);
    });
  }
}

function MelcloudAccessory() {
  
}

/*
Heat = 1
Dry = 2
Cool = 3
Fan = 7
Auto = 8
*/
const MelcloudOperationModes = Object.freeze({
  '1': 'Heat',
  '2': 'Dry',
  '3': 'Cool',
  '7': 'Fan',
  '8': 'Auto'
})

module.exports = Melcloud;