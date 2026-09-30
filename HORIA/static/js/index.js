window.HELP_IMPROVE_VIDEOJS = false;

var INTERP_BASE = "./static/interpolation/stacked";
var NUM_INTERP_FRAMES = 240;

var interp_images = [];
function preloadInterpolationImages() {
  for (var i = 0; i < NUM_INTERP_FRAMES; i++) {
    var path = INTERP_BASE + '/' + String(i).padStart(6, '0') + '.jpg';
    interp_images[i] = new Image();
    interp_images[i].src = path;
  }
}

function setInterpolationImage(i) {
  var image = interp_images[i];
  image.ondragstart = function() { return false; };
  image.oncontextmenu = function() { return false; };
  $('#interpolation-image-wrapper').empty().append(image);
}


$(document).ready(function() {
    // Check for click events on the navbar burger icon
    $(".navbar-burger").click(function() {
      // Toggle the "is-active" class on both the "navbar-burger" and the "navbar-menu"
      $(".navbar-burger").toggleClass("is-active");
      $(".navbar-menu").toggleClass("is-active");

    });

    bulmaCarousel.attach('.carousel-1', {
      slidesToShow: 1,
      slidesToScroll: 1,
      loop: true,
      autoplay: true,
      autoplaySpeed: 15000,
      delay: 15000
    });

    // Run the first SOTA row in the opposite direction. Bulma Carousel has no
    // reverse-autoplay option, so its forward timer is replaced with a small
    // previous-slide timer while preserving hover and tab-visibility pauses.
    var reverseCarouselElement = document.querySelector('#results-carousel-1');
    if (reverseCarouselElement && reverseCarouselElement.bulmaCarousel) {
      var reverseCarousel = reverseCarouselElement.bulmaCarousel;
      var reverseCarouselTimer = null;

      reverseCarousel.stop();
      reverseCarousel.options.autoplay = false;

      function stopReverseCarousel() {
        if (reverseCarouselTimer !== null) {
          window.clearInterval(reverseCarouselTimer);
          reverseCarouselTimer = null;
        }
      }

      function startReverseCarousel() {
        stopReverseCarousel();
        if (!document.hidden) {
          reverseCarouselTimer = window.setInterval(function() {
            reverseCarousel.previous();
          }, 15000);
        }
      }

      reverseCarouselElement.addEventListener('mouseenter', stopReverseCarousel);
      reverseCarouselElement.addEventListener('mouseleave', startReverseCarousel);
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          stopReverseCarousel();
        } else {
          startReverseCarousel();
        }
      });
      startReverseCarousel();
    }

    bulmaCarousel.attach('.carousel-2', {
      slidesToShow: 2,
      slidesToScroll: 1,
      loop: true,
      autoplay: true,
      autoplaySpeed: 15000
    });

    bulmaCarousel.attach('.carousel-3', {
      slidesToShow: 3,
      slidesToScroll: 1,
      loop: true,
      autoplay: true,
      autoplaySpeed: 15000
    });

    // Access to bulmaCarousel instance of an element
    var element = document.querySelector('#my-element');
    if (element && element.bulmaCarousel) {
    	// bulmaCarousel instance is available as element.bulmaCarousel
    	element.bulmaCarousel.on('before-show', function(state) {
    		console.log(state);
    	});
    }

    preloadInterpolationImages();

    $('#interpolation-slider').on('input', function(event) {
      setInterpolationImage(this.value);
    });
    setInterpolationImage(0);
    $('#interpolation-slider').prop('max', NUM_INTERP_FRAMES - 1);

    bulmaSlider.attach();

})
