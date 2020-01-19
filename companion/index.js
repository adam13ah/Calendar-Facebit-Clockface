import * as messaging from "messaging";
import { settingsStorage } from "settings";
import { geolocation } from "geolocation";

import calendars from "calendars";
import * as cbor from "cbor";
import { me as companion } from "companion";
import { outbox } from "file-transfer";

import { toEpochSec } from "../common/utils";
import { dataFile, millisecondsPerMinute } from "../common/constants";

var API_KEY = "5a9de3978c3f1c2eae3026002a35fc27";

// Fetch the weather from OpenWeather
function queryOpenWeather() {
  geolocation.getCurrentPosition(locationSuccess, locationError);
  function locationSuccess(position) {
    var lat = position.coords.latitude;
    var long = position.coords.longitude;
    
    var linkApi = "https://api.openweathermap.org/data/2.5/weather?lat=" + lat + "&lon="  + long + "&units=imperial" + "&APPID=" + API_KEY;
  fetch(linkApi)
  .then(function (response) {
      response.json()
      .then(function(data) {
        // We just want some data
        var weather = {
          temperature: data["main"]["temp"], conditions: data["weather"][0]["main"]
        }
        // Send the weather data to the device
        returnWeatherData(weather);
      });
  })
  .catch(function (err) {
    console.log("Error fetching weather: " + err);
  });
 };
 function locationError(error) {
  console.log("Error: " + error.code,
              "Message: " + error.message);
 }
}

// Send the weather data to the device
function returnWeatherData(data) {
  if (messaging.peerSocket.readyState === messaging.peerSocket.OPEN) {
    // Send a command to the device
    messaging.peerSocket.send(data);
  } else {
    console.log("Error: Connection is not open");
  }
}

// Listen for messages from the device
messaging.peerSocket.onmessage = function(evt) {
  if (evt.data && evt.data.command == "weather") {
    // The device requested weather data
    queryOpenWeather();
  }
}

// Message socket opens
messaging.peerSocket.onopen = () => {
  console.log("Companion Socket Open");
  restoreSettings();
  queryOpenWeather();
};

// Message socket closes
messaging.peerSocket.onclose = () => {
  console.log("Companion Socket Closed");
};

// A user changes settings
settingsStorage.onchange = evt => {
  let data = {
    key: evt.key,
    newValue: evt.newValue
  };
  sendVal(data);
};

// Restore any previously saved settings and send to the device
function restoreSettings() {
  for (let index = 0; index < settingsStorage.length; index++) {
    let key = settingsStorage.key(index);
    if (key) {
      let data = {
        key: key,
        newValue: settingsStorage.getItem(key)
      };
      sendVal(data);
    }
  }
}

// Send data to device using Messaging API
function sendVal(data) {
  if (messaging.peerSocket.readyState === messaging.peerSocket.OPEN) {
    messaging.peerSocket.send(data);
  }
}

// Calendar fetch and send
companion.wakeInterval = 15 * millisecondsPerMinute;
companion.addEventListener("wakeinterval", refreshData);

refreshData();

function refreshData() {
  let dataEvents = [];

  calendars
    .searchSources()
    .then(results => {
      return calendars.searchCalendars();
    })
    .then(results => {
      // Filter events to 48hr window
      const startDate = new Date();
      const endDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(128, 59, 59, 999);
      const eventsQuery = { startDate, endDate };

      return calendars.searchEvents(eventsQuery);
    })
    .then(results => {
      results.forEach(event => {
        // console.log(`> event: ${event.title} (${event.startDate})`);
        dataEvents.push({
          title: event.title,
          location: event.location,
          startDate: toEpochSec(event.startDate),
          endDate: toEpochSec(event.endDate),
          isAllDay: event.isAllDay
        });
      });
      if (dataEvents && dataEvents.length > 0) {
        sendData(dataEvents);
      }
    })
    .catch(error => {
      console.error(error);
      console.error(error.stack);
    });
}

function sendData(data) {
  outbox.enqueue(dataFile, cbor.encode(data)).catch(error => {
    console.warn(`Failed to enqueue data. Error: ${error}`);
  });
}