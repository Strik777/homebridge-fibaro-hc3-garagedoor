import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  NodeCallback,
  Nullable,
  Service
} from "homebridge";

import superagent = require('superagent');


let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("GarageDoor", GarageDoor);
};

class GarageDoor implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly name: string;
  private readonly hc3IP: string;
  private readonly hc3Token: string;
  private readonly switchId: string;
  private readonly sensorId: string;
  private readonly openingDuration: number;
  private readonly closingDuration: number;
  private readonly poolingInterval: number;
  private isOpen: boolean = false;
  private updatePaused: boolean = false;

  private readonly garageDoorService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.hc3IP = config.hc3IP;
    this.hc3Token = config.hc3Token;
    this.switchId = config.switchId;
    this.sensorId = config.sensorId;
    this.openingDuration = config.openingDuration || 30;
    this.closingDuration = config.closingDuration || 30;
    this.poolingInterval = config.poolingInterval || 1;
    this.updatePaused = false;



    this.garageDoorService = new hap.Service.GarageDoorOpener(this.name);


    this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState)
      .on(CharacteristicEventTypes.SET, this.toggleDoorStat.bind(this));

    this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
      .on(CharacteristicEventTypes.GET, (callback: NodeCallback<Nullable<CharacteristicValue>>) => {
        const err = null;
        this.log.debug(`CurrentDoorState requested, ${this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState).value} returned`);
        callback(err, this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState).value);
      });

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "Custom Manufacturer")
      .setCharacteristic(hap.Characteristic.Model, "Custom Model");
    if (this.poolingInterval) {
      setInterval(this.getStatus.bind(this), this.poolingInterval*1000);
    } else {
      this.getStatus()
    }

    log.info("Garage door finished initializing!");
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.garageDoorService,
    ];
  }

  async getStatus(): Promise<void> {
    if (this.updatePaused == true) {
      this.log.debug('Updater: Sorry, I\'m on hold');
      return;
    }
    this.log.debug('Updater: Status update');
    let url = `http://${this.hc3IP}/api/devices/${this.sensorId}`;
    try {
      let response = await superagent.get(url)
        .set('accept', 'accept')
        .set('X-Fibaro-Version', '2')
        .set('Accept-language', 'ru')
        .set('Authorization', `Basic ${this.hc3Token}`);
      let deviceData = JSON.parse(response.text);
      this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
        .updateValue(deviceData.properties.value ? 0 : 1)
      this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState)
        .updateValue(deviceData.properties.value ? 0 : 1)
    } catch (err) {
      this.log.error(err);
    }
  }

  async toggleDoorStat(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    let url = `http://${this.hc3IP}/api/devices/${this.switchId}/action/turnOn`;
    let updateTimeout;
    try {
      let response = await superagent.post(url)
        .set('accept', 'accept')
        .set('X-Fibaro-Version', '2')
        .set('Accept-language', 'ru')
        .set('Authorization', `Basic ${this.hc3Token}`)
        .send({
          "args": [
            {},
            {}
          ],
          delay: 0
        });

      switch (this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState).value) {
        case hap.Characteristic.CurrentDoorState.OPEN: {
          this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState)
            .updateValue(hap.Characteristic.TargetDoorState.CLOSED);
          this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
            .updateValue(hap.Characteristic.CurrentDoorState.CLOSING);
          break;
        }
        case hap.Characteristic.CurrentDoorState.CLOSED: {
          this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState)
            .updateValue(hap.Characteristic.TargetDoorState.OPEN);
          this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
            .updateValue(hap.Characteristic.CurrentDoorState.OPENING);
          break;
        }
        case hap.Characteristic.CurrentDoorState.OPENING: {
          this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState)
            .updateValue(hap.Characteristic.TargetDoorState.CLOSED);
          this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
            .updateValue(hap.Characteristic.CurrentDoorState.STOPPED);
          break;
        }
        case hap.Characteristic.CurrentDoorState.CLOSING: {
          this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState)
            .updateValue(hap.Characteristic.TargetDoorState.OPEN);
          this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
            .updateValue(hap.Characteristic.CurrentDoorState.STOPPED);
          break;
        }
        case hap.Characteristic.CurrentDoorState.STOPPED: {
          //Target was updated on stop
          this.garageDoorService.getCharacteristic(hap.Characteristic.CurrentDoorState)
            .updateValue(this.garageDoorService.getCharacteristic(hap.Characteristic.TargetDoorState).value == hap.Characteristic.TargetDoorState.OPEN ? hap.Characteristic.CurrentDoorState.OPENING : hap.Characteristic.CurrentDoorState.CLOSING);
          break;
        }
      }
      this.updatePaused = true;
      this.log.debug('Updater now on hold');
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        this.updatePaused = false
        this.log.debug('Updater was activated again');
      }, this.openingDuration*1000);
      callback();
    } catch {
      this.log.error('Toggle error')
    }
  }
}
