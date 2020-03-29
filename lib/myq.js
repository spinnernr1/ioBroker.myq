const request = require('request');

const MYQ_API_URL = "https://myqexternal.myqdevice.com";
const MYQ_APP_ID = "Vj8pQggXLhLy0WHahglCD4N1nAkkXQtGYpq2HrHD7H1nvmbT55KqtN6RSF4ILB/i";

const MYQ_LOGIN_ENDPOINT = "api/v4/User/Validate";
const MYQ_LIST_ENDPOINT = "api/v4/UserDeviceDetails/Get";
const MYQ_SET_ENDPOINT = "api/v4/DeviceAttribute/PutDeviceAttribute";

const MYQ_DOOR_STATES = {
    '1': 'open',
    '2': 'closed',
    '3': 'stopped',
    '4': 'opening',
    '5': 'closing',
    '8': 'moving',
    '9': 'not closed'
};

const MYQ_LAMP_STATES = {
    '0': 'off',
    '1': 'on'
};

const MYQ_RETURN_CODES = {
	'-3333': 'Not logged in / missing security token',
	'203': 'Invalid login data',
	'205': 'Too many failed logins. One more and you will be locked out.',
	'207': 'You are locked out due to failed logins. Please reset password.',
	'217': 'Could not process request, e. g. due to missing parameter'
};

const MYQ_DEVICE_TYPES = {
	'1': 'Gateway',
	'2': 'GDO',
	'3': 'Light',
	'5': 'Gate',
	'7': 'VGDO Garage Door',
	'9': 'Commercial Door Operator (CDO)',
	'13': 'Camera',
	'15': 'WGDO Gateway AC',
	'16': 'WGDO Gateway DC',
	'17': 'WGDO Garage Door'
};

function MyQ(username, password, context) {
    this.username = username;
    this.password = password;
    this.context = context;

    this.securityToken = null;
    this.apiRequest = request.defaults({
        headers: {
            'MyQApplicationId': MYQ_APP_ID,
            'Content-Type': 'application/json'
        }
    });
}

MyQ.prototype.login = function(callback) {
    let controller = this;

    if(this.securityToken) {
        callback(false, {});
        return;
    }

    this.apiRequest.post({
        url: MYQ_API_URL + '/' + MYQ_LOGIN_ENDPOINT,
        json: {
            username: this.username,
            password: this.password
        }
    }, function(error, response, body) {
        let json;
        if(typeof body === 'object') {
            json = body;
        } else {
            try {
                json = JSON.parse(body);
            } catch(e) {
                json = {
                    ReturnCode: "X",
                    ErrorMessage: "Unreadable json response body: " + body
                };
            }
        }
        if(!error && response.statusCode === 200 && json.ReturnCode == "0") {
            controller.securityToken = json.SecurityToken;
            controller.apiRequest = request.defaults({
                headers: {
                    'MyQApplicationId': MYQ_APP_ID,
                    'SecurityToken': controller.securityToken,
                    'Content-Type': 'application/json'
                }
            });
			controller.context.setState('info.connection', true, true);
            callback(false, {});
        } else {
            controller.context.log.warn('Login failed.');
            callback(true, {code: json.ReturnCode, msg: json.ErrorMessage});
            controller.context.stop();
        }
    });
};

MyQ.prototype.cmdOpenDoor = function(device, callback) {
    this.changeDoorState(device, 'open', callback);
};

MyQ.prototype.cmdCloseDoor = function(device, callback) {
    this.changeDoorState(device, 'close', callback);
};

MyQ.prototype.cmdLampOn = function(device, callback) {
    this.changeLampState(device, 'on', callback);
};

MyQ.prototype.cmdLampOff = function(device, callback) {
    this.changeLampState(device, 'off', callback);
};

MyQ.prototype.getDevices = function(callback) {
    let controller = this;

    this.login(function(err, obj) {
        if(err) {
            callback(err, obj);
            return;
        }
        controller.apiRequest.get({
            url: MYQ_API_URL + '/' + MYQ_LIST_ENDPOINT
        }, function(error, response, body) {
            let json;
            if(typeof body === 'object') {
                json = body;
            } else {
                try {
                    json = JSON.parse(body);
                } catch(e) {
                    json = {
                        ReturnCode: "X",
                        ErrorMessage: "Unreadable json response body: " + body
                    };
                }
            }
            if(!error && response.statusCode === 200 && json.ReturnCode == "0") {
                if(!json.Devices) {
                    json.Devices = [];
                }
                let valid = [];
                let dev;
                let devType;
                for(let key in json.Devices) {
                    dev = json.Devices[key];
                    devType = dev['MyQDeviceTypeName'];
                    //if(["VGDO", "GarageDoorOpener", "Garage Door Opener WGDO", "LampModule"].indexOf(devType) > -1) {
                        valid.push(dev);
                    //}
                }
                callback(false, {devices: valid});
			} else if(json && json.ReturnCode == "-3333") {
				controller.securityToken = null;
				controller.context.log.info('Login expired. Need to re-login.');
				callback(true, {code: json.ReturnCode, msg: json.ErrorMessage})
            } else {
                controller.context.log.warn('getDevices failed.');
                callback(true, {code: json.ReturnCode, msg: json.ErrorMessage});
            }
        });
    });
};

MyQ.prototype.changeDeviceState = function(device, attr, value, callback) {
    let controller = this;

    this.login(function(err, obj) {
        if(err) {
            callback(err, obj);
            return;
        }
        controller.apiRequest.put({
            url: MYQ_API_URL + '/' + MYQ_SET_ENDPOINT,
            json: {
                AttributeName: attr,
                MyQDeviceId: device,
                AttributeValue: value
            }
        }, function(error, response, body) {
            let json;
            if(typeof body === 'object') {
                json = body;
            } else {
                try {
                    json = JSON.parse(body);
                } catch(e) {
                    json = {
                        ReturnCode: "X",
                        ErrorMessage: "Unreadable json response body: " + body
                    };
                }
            }
            if(!error && response.statusCode === 200 && json.ReturnCode == "0") {
                callback(false, {});
            } else {
                controller.context.log.warn('changeDeviceState failed.');
                callback(true, {code: json.ReturnCode, msg: json.ErrorMessage, raw: body});
            }
        });
    });
};

MyQ.prototype.changeDoorState = function(device, value, callback) {
    if(value === "open") {
        value = "1";
    } else if(value === "close") {
        value = "0";
    }

    if(value != "1" && value != "0") {
        callback(true, {});
        return;
    }

    this.changeDeviceState(device, 'desireddoorstate', value, callback);
};

MyQ.prototype.changeLampState = function(device, value, callback) {
    if(value === "on") {
        value = "1";
    } else if(value === "off") {
        value = "0";
    }

    if(value != "1" && value != "0") {
        callback(true, {});
        return;
    }

    this.changeDeviceState(device, 'desiredlightstate', value, callback);
};

module.exports = {
	MyQ: MyQ
};
