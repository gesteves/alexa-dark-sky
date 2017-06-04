const Alexa = require('alexa-sdk');
const request = require('request');
const async = require('async');

exports.handler = function (event, context, callback) {
  const alexa = Alexa.handler(event, context);
  alexa.appId = process.env.ALEXA_APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
    'LaunchRequest': function () {
        this.emit(':ask', 'What do you want to know?', "I'm sorry, could you say that again?");
    },
    'ForecastIntent': function () {
      let location;
      if (this.event.request.intent.slots.address.value) {
        location = this.event.request.intent.slots.address.value;
      } else if (this.event.request.intent.slots.city.value) {
        location = this.event.request.intent.slots.city.value;
      }

      if (typeof location === 'undefined') {
        this.emit(':ask', "I'm sorry, I couldn't understand your location. Can you try a different one?", "I'm sorry, could you say that again?");
      } else {
        let intent = this;
        let formatted_address;
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
    },
};

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
