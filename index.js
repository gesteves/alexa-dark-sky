const Alexa = require('alexa-sdk');
const request = require('request');
const async = require('async');
const Redis = require('redis');
const redis = Redis.createClient(process.env.REDIS_URL);

exports.handler = function (event, context, callback) {
  // TODO: There's gotta be a better way of storing data in Lambda
  const alexa = Alexa.handler(event, context);
  alexa.appId = process.env.ALEXA_APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
  'LaunchRequest': LaunchRequestHandler,
  'LocationForecastIntent': LocationForecastIntentHandler,
  'EchoForecastIntent': EchoForecastIntentHandler
};

/*
  INTENT HANDLERS
*/

// Launch request, i.e. "Alexa, open Dark Sky"
function LaunchRequestHandler () {
  let intent = this;
  let user_id = this.event.session.user.userId;
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.event.session.user.permissions.consentToken;

  // 1. Store the consent token from the request in redis so it can be used
  // later to access the Echo's address.
  // 2. Ask the user what they want to do.
  // TODO: Handle the case where the user hasn't given permission to access
  // the address.
  async.waterfall([
    function (next) {
      redis.set(`lambda:alexa:user:${user_id}`, consent_token, next);
    },
    function (response, next) {
      intent.emit(':ask', 'What do you want to know?', "I'm sorry, could you say that again?");
    }
  ]);
}

// Handle a forecast intent when the user has not included a location ("what's the weather").
// In this case, get the forecast for the address set in the Echo, using the consent token.
// TODO: Handle the case where the address is not set or the user hasn't granted permission.
function EchoForecastIntentHandler() {
  let intent = this;
  let user_id = this.event.session.user.userId;
  let device_id = this.event.context.System.device.deviceId;
  let formatted_address;

  // 1. Get the user's consent token from Redis.
  // 2. Use the token to request the Echo's address from Amazon.
  // 2. Geocode the Echo's address to geographic coordinates.
  // 3. Pass the coordinates to Dark Sky and get the forecast to that location.
  // 4. Parse the forecast and emit it back to the user.
  // TODO: Handle invalid locations
  // TODO: Handle nonexistant forecasts
  // TODO: Error handling
  async.waterfall([
    function (next) {
      redis.get(`lambda:alexa:user:${user_id}`, next);
    },
    function (token, next) {
      let options = {
        url: `https://api.amazonalexa.com/v1/devices/${device_id}/settings/address`,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      };
      request(options, next);
    },
    function (error, body, next) {
      let location = echoAddressToString(body);
      request(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${process.env.MAPS_API_KEY}`, next);
    },
    function (error, body, next) {
      let geocoded_location = JSON.parse(body);
      if (geocoded_location.status === 'OK') {
        formatted_address = geocoded_location.results[0].formatted_address;
        let lat = geocoded_location.results[0].geometry.location.lat;
        let long = geocoded_location.results[0].geometry.location.lng;
        request(`https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${lat},${long}`, next);
      }
    },
    function (error, body, next) {
      let forecast = JSON.parse(body);
      forecast.formatted_address = formatted_address;
      intent.emit(':tell', forecast_ssml(forecast));
    }
  ]);
}

// Handle a forecast intent when the user has included a city ("what's the weather in DC"),
// or an address ("what's the address in 1600 pennsylvania avenue").
function LocationForecastIntentHandler() {
  let intent = this;
  let location = this.event.request.intent.slots.city.value || this.event.request.intent.slots.address.value;
  let formatted_address;

  // 1. Geocode the spoken location to geographic coordinates.
  // 2. Pass the coordinates to Dark Sky and get the forecast to that location.
  // 3. Parse the forecast and emit it back to the user.
  // TODO: Handle invalid locations
  // TODO: Handle nonexistant forecasts
  // TODO: Error handling
  async.waterfall([
    function (next) {
      request(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${process.env.MAPS_API_KEY}`, next);
    },
    function (error, body, next) {
      let geocoded_location = JSON.parse(body);
      if (geocoded_location.status === 'OK') {
        formatted_address = geocoded_location.results[0].formatted_address;
        let lat = geocoded_location.results[0].geometry.location.lat;
        let long = geocoded_location.results[0].geometry.location.lng;
        request(`https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${lat},${long}`, next);
      }
    },
    function (error, body, next) {
      let forecast = JSON.parse(body);
      forecast.formatted_address = formatted_address;
      intent.emit(':tell', forecast_ssml(forecast));
    }
  ]);
}

/*
  HELPER FUNCTIONS
*/

// Format the Dark Sky forecast into a spoken sentence using SSML.
function forecast_ssml(forecast) {
  let text = `Here's the forecast for <say-as interpret-as="address">${forecast.formatted_address}</say-as>`;

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `\nRight now: ${now.summary}, ${Math.round(now.temperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°`;
    } else {
      text += `\nRight now: ${now.summary}, ${Math.round(now.temperature)}° but it feels like ${Math.round(now.apparentTemperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°`;
    }
  }

  if (forecast.minutely) {
    text += `\nNext hour: ${forecast.minutely.summary}`;
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.map(function (d) {
      return d.apparentTemperature;
    });
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `\nNext 24 hours: ${forecast.hourly.summary.replace(/\.$/, '')}, with a high of ${high}° and a low of ${low}°.`;
  }

  if (forecast.daily) {
    text += `\nNext 7 days: ${forecast.daily.summary}`;
  }

  return text;
}

// Returns the Echo's address as a sentence
function echoAddressToString(address) {
  let address_obj = JSON.parse(address);
  var location_array = [];
  location_array.push(address_obj.addressLine1);
  location_array.push(address_obj.addressLine2);
  location_array.push(address_obj.addressLine3);
  location_array.push(address_obj.city);
  location_array.push(address_obj.stateOrRegion);
  location_array.push(address_obj.countryCode);
  location_array.push(address_obj.postalCode);
  return location_array.filter(function (i) {
    return i;
  }).join(', ');
}
