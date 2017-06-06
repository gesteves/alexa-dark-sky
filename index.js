const Alexa = require('alexa-sdk');
const Imgix = require('imgix-core-js');
const request = require('request-promise-native');
const imgix = new Imgix({
  host: process.env.IMGIX_DOMAIN,
  secureURLToken: process.env.IMGIX_TOKEN
});

exports.handler = function(event, context, callback) {
  const alexa = Alexa.handler(event, context);
  alexa.appId = process.env.ALEXA_APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
  'LaunchRequest': launchRequestHandler,
  'LocationForecastIntent': locationForecastIntentHandler,
  'EchoForecastIntent': echoForecastIntentHandler,
  'EchoTemperatureIntent': echoTemperatureIntentHandler,
  'StormIntent': stormIntentHandler,
  'AMAZON.StopIntent': stopIntentHandler,
  'AMAZON.CancelIntent': cancelIntentHandler,
  'AMAZON.HelpIntent': helpIntentHandler,
  'Unhandled': unhandledIntentHandler
};

/**
 * Handles launch requests, i.e. "Alexa, open Cloud Cast".
 */
function launchRequestHandler() {
  this.emit(':ask', 'What do you want to know?', "I'm sorry, could you say that again?");
}

/**
 * Handles an `EchoForecastIntent`, which is when the user requests the forecast
 * without specifying a location (e.g. "what's the weather?"). In this case,
 * this method:
 * 1. Gets the address of the Echo, using the consent token,
 * 2. Geocodes the address using the Google Maps API,
 * 3. Gets the forecast for the address's coordinates from Dark Sky, and
 * 4. Emits an Alexa response with a card, with the forecast.
 */
function echoForecastIntentHandler() {
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.event.context.System.user.permissions.consentToken;

  getEchoAddress(device_id, consent_token).
    then(geocodeLocation).
    then(getForecast).
    then(forecast => { this.emit(':tellWithCard', forecastSsml(forecast), 'Weather Forecast', forecastPlain(forecast), forecastImage(forecast)); }).
    catch(error => { this.emit(':tell', error.message); });
}

/**
 * Handles a `LocationForecastIntent`, which is when the user requests the forecast
 * specifying a city or address (e.g. "what's the weather in NYC?"). In this case,
 * this method:
 * 1. Geocodes the given location using the Google Maps API,
 * 2. Gets the forecast for the locations's coordinates from Dark Sky, and
 * 3. Emits an Alexa response with a card, with the forecast.
 */
function locationForecastIntentHandler() {
  let location = this.event.request.intent.slots.city.value || this.event.request.intent.slots.address.value;

  geocodeLocation(location).
    then(getForecast).
    then(forecast => { this.emit(':tellWithCard', forecastSsml(forecast), 'Weather Forecast', forecastPlain(forecast), forecastImage(forecast)); }).
    catch(error => { this.emit(':tell', error.message); });
}

/**
 * Handles a `EchoTemperatureIntent`, which is when the user requests the temperature.
 * This method:
 * 1. Gets the address of the Echo, using the consent token,
 * 2. Geocodes the address using the Google Maps API,
 * 3. Gets the forecast for the address's coordinates from Dark Sky, and
 * 4. Emits an Alexa response, with the temperature.
 */
function echoTemperatureIntentHandler() {
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.event.context.System.user.permissions.consentToken;

  getEchoAddress(device_id, consent_token).
    then(geocodeLocation).
    then(getForecast).
    then(forecast => { this.emit(':tell', temperatureSsml(forecast)); }).
    catch(error => { this.emit(':tell', error.message); });
}

/**
 * Handles a `StormIntent`, which is when the user asks if there are storms nearby.
 * This method:
 * 1. Gets the address of the Echo, using the consent token,
 * 2. Geocodes the address using the Google Maps API,
 * 3. Gets the forecast for the address's coordinates from Dark Sky, and
 * 4. Emits an Alexa response, with the answer.
 */
function stormIntentHandler() {
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.event.context.System.user.permissions.consentToken;

  getEchoAddress(device_id, consent_token).
    then(geocodeLocation).
    then(getForecast).
    then(forecast => { this.emit(':tell', stormSsml(forecast)); }).
    catch(error => { this.emit(':tell', error.message); });
}

function stopIntentHandler() {
  this.emit(':tell', "Okay");
}

function cancelIntentHandler() {
  this.emit(':tell', "Okay");
}

function helpIntentHandler() {
  this.emit(':ask', `<p>Here are a few things you can do:</p>
  <p>To get the forecast for your current location, ask 'how's the weather'.</p>
  <p>You can also get the forecast at a specific location, like 'how's the weather in new york'<p>
  <p>To get the current temperature, ask: 'what's the temperature'</p>
  <p>To find the nearest storm, ask: 'where's the nearest storm'`);
}

function unhandledIntentHandler() {
  this.emit(':ask', "I didn't get that. To get the forecast for your current location, ask 'how's the weather'. You can also specify a location, like 'how's the weather in new york'");
}

/**
 * Requests the Echo's address from the Alexa API.
 * @param {string} device_id The Echo's device ID.
 * @param {string} consent_token The user's consent token.
 * @return {Promise.<string>} A promise that resolves to the address, formatted as
 * a string; or is rejected if the user hasn't granted permission.
 */
function getEchoAddress(device_id, consent_token) {
  let opts = {
    url: `https://api.amazonalexa.com/v1/devices/${device_id}/settings/address`,
    headers: {
      'Authorization': `Bearer ${consent_token}`
    },
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if (response.statusCode === 200) {
      return echoAddressToString(response.body);
    } else {
      return Promise.reject(new Error("I'm sorry, I couldn't get your location. Make sure you've given this skill permission to use your address in the Alexa app."));
    }
  });
}

/**
 * Geocodes a location or address using the Google Maps API.
 * @param {string} location An address or location (e.g. "1600 pennsylvania avenue, washington, dc",
 * or "nyc").
 * @return {Promise.<Object>} A promise that resolves to the first result from the API, or
 * is rejected if the address is not valid.
 */
function geocodeLocation(location) {
  let opts = {
    url: `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${process.env.MAPS_API_KEY}`,
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if ((response.statusCode === 200) && (response.body.status === 'OK')) {
      return response.body.results[0];
    } else {
      return Promise.reject(new Error("I'm sorry, I couldn't understand that address."));
    }
  });
}

/**
 * Gets the Dark Sky forecast for a given location.
 * @param {Object} location A geocoded location returned from the Google Maps geocoding API.
 * @return {Promise.<Object>} A promise that resolves to the Dark Sky API response, or
 * is rejected if the API doesn't return a forecast.
 */
function getForecast(location) {
  let opts = {
    url: `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${location.geometry.location.lat},${location.geometry.location.lng}`,
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if ((response.statusCode !== 200) || (!response.body.currently && !response.body.minutely && !response.body.hourly)) {
      return Promise.reject(new Error("I'm sorry, I couldn't get the forecast for that location."));
    } else {
      let forecast = response.body;
      forecast.address = location.formatted_address;
      return forecast;
    }
  });
}

/**
 * Formats a Dark Sky forecast into a spoken sentence with SSML.
 * @param {Object} forecast A forecast object from the Dark Sky API.
 * @return {string} A nicely formatted text of the forecast.
 */
function forecastSsml(forecast) {
  let text = `<p>Here's the forecast for <say-as interpret-as="address">${forecast.address}</say-as></p>`;

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `<p>Right now: ${now.summary}, ${Math.round(now.temperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.</p>`;
    } else {
      text += `<p>Right now: ${now.summary}, ${Math.round(now.temperature)}°, but it feels like ${Math.round(now.apparentTemperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.</p>`;
    }
  }

  if (forecast.minutely) {
    text += `<p>Next hour: ${forecast.minutely.summary}</p>`;
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.slice(0, 24).map(d => d.apparentTemperature);
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `<p>Next 24 hours: ${forecast.hourly.summary.replace(/\.$/, '')}, with a high of ${high}° and a low of ${low}°.</p>`;
  }

  return text;
}

/**
 * Formats a Dark Sky forecast into plain text.
 * @param {Object} forecast A forecast object from the Dark Sky API.
 * @return {string} A nicely formatted text of the forecast.
 */
function forecastPlain(forecast) {
  let text = `Here's the forecast for ${forecast.address}`;

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `\nRight now: ${now.summary}, ${Math.round(now.temperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.`;
    } else {
      text += `\nRight now: ${now.summary}, ${Math.round(now.temperature)}°, but it feels like ${Math.round(now.apparentTemperature)}°, with ${parseInt(now.humidity * 100)}% humidity, and a dew point of ${Math.round(now.dewPoint)}°.`;
    }
  }

  if (forecast.minutely) {
    text += `\nNext hour: ${forecast.minutely.summary}`;
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.slice(0, 24).map(d => d.apparentTemperature);
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `\nNext 24 hours: ${forecast.hourly.summary.replace(/\.$/, '')}, with a high of ${high}° and a low of ${low}°.`;
  }

  return text;
}

/**
 * Formats a Dark Sky temperature forecast into a spoken sentence with SSML.
 * @param {Object} forecast A forecast object from the Dark Sky API.
 * @return {string} A nicely formatted text of the temperature.
 */
function temperatureSsml(forecast) {
  let text = '';

  if (forecast.currently) {
    let now = forecast.currently;
    if (Math.round(now.temperature) === Math.round(now.apparentTemperature)) {
      text += `<p>It's ${Math.round(now.temperature)}° right now.</p>`;
    } else {
      text += `<p>It's ${Math.round(now.temperature)}° right now, but it feels like ${Math.round(now.apparentTemperature)}°.</p>`;
    }
  }

  if (forecast.hourly) {
    let apparentTemperatures = forecast.hourly.data.slice(0, 24).map(d => d.apparentTemperature);
    let high = Math.round(Math.max(...apparentTemperatures));
    let low = Math.round(Math.min(...apparentTemperatures));
    text += `\nFor the next 24 hours, the high is ${high}°, and the low is ${low}°.`;
  }

  return text;
}

/**
 * Returns the closest storm and its bearing, in an SSML-formatted sentence.
 * @param {Object} forecast A forecast object from the Dark Sky API.
 * @return {string} An SSML-formatted sentence.
 */
function stormSsml(forecast) {
  let text;

  if (forecast.currently) {
    let now = forecast.currently;
    if (!now.nearestStormDistance) {
      text = "<p>Looks like there aren't any storms nearby.</p>";
    } else if (now.nearestStormDistance === 0) {
      text = "<p>There's a storm in the vicinity of your location!</p>";
    } else {
      text = `<p>The nearest storm is about ${now.nearestStormDistance} miles to the ${degreesToCompass(now.nearestStormBearing)} of your current location.</p>`;
    }
  }

  return text;
}

/**
 * Return an image object with the icons for the given forecast.
 * @param {Object} forecast A forecast object from the Dark Sky API.
 * @return {Object} A set of images describing the given forecast.
 */
function forecastImage(forecast) {
 let images = ['clear-day',
               'clear-night',
               'rain',
               'sleet',
               'hail',
               'snow',
               'wind',
               'fog',
               'cloudy',
               'partly-cloudy-day',
               'partly-cloudy-night',
               'thunderstorm',
               'tornado'];

  if (images.includes(forecast.currently.icon)) {
    let url = `https://s3.amazonaws.com/${process.env.S3_BUCKET}/images/${forecast.currently.icon}.png`;
    return {
      smallImageUrl: imgix.buildURL(url, { w: 720 }),
      largeImageUrl: imgix.buildURL(url, { w: 1200 })
    };
  }
}

/**
 * Return an Echo's address as a sentence (e.g. "1600 Pennsylvania Avenue, Washington, DC")
 * @param {Object} address An address object from the Alexa API.
 * @return {string} A string with the Echo's address.
 */
function echoAddressToString(address) {
  let location_array = [];
  location_array.push(address.addressLine1);
  location_array.push(address.addressLine2);
  location_array.push(address.addressLine3);
  location_array.push(address.city);
  location_array.push(address.stateOrRegion);
  location_array.push(address.countryCode);
  location_array.push(address.postalCode);
  return location_array.filter(i => i).join(', ');
}

/**
 * Converts an direction to roughly a compass direction.
 * @param {float} bearing A compass angle, with 0° at true north.
 * @return {string} A cardinal direction.
 */
function degreesToCompass(bearing) {
  var compass = ["North", "North East", "East", "South East", "South", "South West", "West", "North West"];
  var val = Math.round((bearing/(360/compass.length)));
  return compass[(val % compass.length)];
}
