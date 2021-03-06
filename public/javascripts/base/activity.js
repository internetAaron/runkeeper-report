define(['jquery', 'asyncStorage', './googlemap'],
  function($, asyncStorage, googlemap) {
  'use strict';

  var MAX_TIME = 3600; // 1 hour limit for hitting Runkeeper's server

  var body = $('body');

  var Activity = function () {
    this.activityIds = [];
    this.activities = [];
    this.calories = 0;
    this.detailCount = 0;

    var self = this;

    /**
     * Assuming that onl walking and hiking are moderate activities and count by the minute.
     * Vigorous activities are counted as 2 minutes of exercise per minute.
     */
    var totalMinutes = function (self, data) {
      var minutes = 0;
      for (var i = 0; i < data.length; i ++) {
        var startTime = Date.parse(data[i].startTime || data[i].start_time) / 1000;
        var day = (self.currentTime - startTime) / 60 / 60 / 24;

        if (day < 8.0) {
          switch (data[i].type.toLowerCase()) {
            case 'hiking':
            case 'cycling':
            case 'walking':
              minutes += Math.round(data[i].duration / 60);
              break;
            default:
              minutes += Math.round(data[i].duration / 60) * 2;
              break;
          }
          self.calories += data[i].calories;
        } else {
          break;
        }
      }

      return minutes;
    };

    var totalDistance = function (self, data) {
      var distance = 0;
      for (var i = 0; i < data.length; i ++) {
        var startTime = Date.parse(data[i].startTime || data[i].start_time) / 1000;
        var day = (self.currentTime - startTime) / 60 / 60 / 24;

        if (day < 8.0) {
          distance += (data[i].totalDistance / 1000);
        } else {
          break;
        }
      }

      return Math.round(distance);
    };

     var totalCalories = function (self, data) {
      var calories = 0;
      for (var i = 0; i < data.length; i ++) {
        var startTime = Date.parse(data[i].startTime || data[i].start_time) / 1000;
        var day = (self.currentTime - startTime) / 60 / 60 / 24;

        if (day < 8.0) {
          calories += data[i].calories;
        } else {
          break;
        }
      }

      return calories;
    };

    var formatDuration = function (data) {
      for (var i = 0; i < data.length; i ++) {
        var hourFrac = data[i].duration / 60 / 60;
        var hour = Math.floor(hourFrac);
        var minFrac = hourFrac % 1 * 60;
        var minutes = Math.floor(minFrac);
        var seconds = Math.floor(minFrac % 1 * 60);

        if (hour > 0 && hour < 10) {
          hour = '0' + hour;
        }

        if (minutes > 0 && minutes < 10) {
          minutes = '0' + minutes;
        }

        if (seconds > 0 && seconds < 10) {
          seconds = '0' + seconds;
        } else {
          seconds = '00';
        }

        if (hour > 0) {
          data[i].duration = hour + ':' + minutes + ':' + seconds;
        } else if (minutes > 0) {
          data[i].duration = '00:' + minutes + ':' + seconds;
        } else {
          data[i].duration = '00:00:' + seconds;
        }
      }

      return data;
    };

    var loadCachedActivities = function (self, callback) {
      console.log('loading cached')
      asyncStorage.getItem('activityIds', function (data) {
        self.activityIds = data;

        for (var i = 0; i < self.activityIds.length; i ++) {
          asyncStorage.getItem('activity:' + self.activityIds[i], function (activity) {
            self.activities.push(activity);

            if (self.activities.length === self.activityIds.length) {
              self.activities = self.activities.sort(function (a, b) {
                if (a.id && b.id) {
                  return parseInt(b.id, 10) - parseInt(a.id, 10);
                }
              });

              callback(null, {
                minutes: totalMinutes(self, self.activities),
                distance: totalDistance(self, self.activities),
                calories: totalCalories(self, self.activities),
                activities: formatDuration(self.activities)
              });
            }
          });
        }
      });
    };

    var getOnlineActivities = function (accessToken, callback) {
      $.ajax({
        url: '/fitnessActivities',
        method: 'GET',
        dataType: 'json'
      }).done(function (data) {
        var count = 1;
        data = data.feed;

        for (var i = 0; i < data.items.length; i ++) {
          data.items[i].id = data.items[i].uri.split('/').reverse()[0];
          data.items[i].startTime = data.items[i].start_time;

          if (count === data.items.length) {
            callback(null, data.items);
          }

          count ++;
        }
      }).fail(function (err) {
        callback(err);
      });
    };

    var getActivityDetail = function (self, id) {
      setTimeout(function () {
        $.ajax({
          url: '/activity/' + id,
          method: 'GET',
          dataType: 'json'
        }).done(function (data) {
          asyncStorage.setItem('activity:' + id, {
            id: id,
            duration: data.activity.duration,
            startTime: data.activity.start_time,
            totalDistance: data.activity.total_distance,
            type: data.activity.type,
            calories: data.activity.total_calories,
            totalClimb: data.activity.total_climb,
            path: data.activity.path
          });

          var startTime = Date.parse(data.activity.startTime || data.activity.start_time) / 1000;
          var day = (self.currentTime - startTime) / 60 / 60 / 24;

          if (day < 8.0) {
            var distanceVal = parseInt(body.find('.distance-value').text(), 10);
            var calorieVal = parseInt(body.find('.calorie-value').text(), 10);

            body.find('.distance-value').text(Math.round(distanceVal + (data.activity.total_distance) / 1000));
            body.find('.calorie-value').text(calorieVal + data.activity.total_calories);
            body.find('#')
          }
        }).fail(function (err) {
          console.log('could not get data for ', id, err);
        });
      }, 1000);
    };

    var cacheActivities = function (self, data) {
      for (var i = 0; i < data.length; i ++) {
        var id = parseInt(data[i].uri.split('/')[2], 10);

        if (self.activityIds.indexOf(id) < 0) {
          self.activityIds.push(id);
        }

        asyncStorage.setItem('activityIds', self.activityIds);
        getActivityDetail(self, id);
      }
    };

    /**
     * Get all recent activities
     * If we've retrieved activities in the past hour or we are offline, load the cached
     * activities from indexedDb.
     */
    this.getAll = function (callback) {
      var self = this;
      this.currentTime = Math.round(new Date() / 1000);

      asyncStorage.getItem('lastChecked', function (lastTime) {
        if (!lastTime || self.currentTime - lastTime >= MAX_TIME) {
          getOnlineActivities(self.accessToken, function (err, data) {
            if (err) {
              callback(err);
            } else {
              asyncStorage.setItem('lastChecked', self.currentTime);
              cacheActivities(self, data);

              callback(null, {
                minutes: totalMinutes(self, data),
                distance: totalDistance(self, self.activities),
                calories: totalCalories(self, self.activities),
                activities: formatDuration(data)
              });
            }
          });
        } else {
          loadCachedActivities(self, callback);
        }
      });
    },

    this.getDetail = function (activity) {
      body.find('#detail').removeClass('hidden');

      asyncStorage.getItem('activity:' + activity.data('id'), function (a) {
        if (a.path.length > 0) {
          googlemap.drawMap(a.path);
        }
        body.find('#detail .activity-type span')
            .removeClass()
            .addClass(a.type.toLowerCase())
            .text(a.type);
        body.find('#detail .duration span').text(formatDuration([a])[0].duration);
        body.find('#detail time').text(a.startTime);
        body.find('#detail .calories span').text(a.calories);
        body.find('#detail .distance span').text(Math.round(a.totalDistance / 10) / 100);
      });
    }
  };

  return Activity;
});
