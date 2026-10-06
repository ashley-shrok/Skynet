// Skynet: keep draw.io's viewer on this server. Its defaults point at
// viewer.diagrams.net for styles, stencils, shapes, images, maths and an
// image proxy; the page's CSP blocks those anyway, this avoids the attempts.
(function () {
  var base = location.pathname.replace(/[^/]*$/, "") + "v32.0.2/";
  window.STYLE_PATH = base + "styles";
  window.STENCIL_PATH = base + "stencils";
  window.SHAPES_PATH = base + "shapes";
  window.IMAGE_PATH = base + "images";
  window.mxBasePath = base + "mxgraph";
  window.mxImageBasePath = base + "mxgraph/images";
  window.DRAW_MATH_URL = base + "math";
  window.PROXY_URL = null;
  window.DRAWIO_LOG_URL = null;
  window.mxLoadResources = false;
  window.mxLoadStylesheets = false;
})();
