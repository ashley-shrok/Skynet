// Skynet: renders the diagram the parent page sends ({type:"open", xml})
// with draw.io's GraphViewer, and reports back ({type:"rendered", pages} or
// {type:"error"}). Runs in an opaque-origin sandbox, so messages go to "*";
// the parent checks event.source.
(function () {
  function send(msg) {
    window.parent.postMessage(Object.assign({ source: "skynet-drawio" }, msg), "*");
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.type !== "open") return;
    var container = document.getElementById("diagram");
    container.innerHTML = "";
    try {
      var doc = mxUtils.parseXml(e.data.xml);
      var root = doc.documentElement;
      if (!root || (root.nodeName !== "mxfile" && root.nodeName !== "mxGraphModel")) {
        throw new Error("not a draw.io diagram");
      }
      var pages = root.nodeName === "mxfile" ? root.getElementsByTagName("diagram").length : 1;
      var div = document.createElement("div");
      div.setAttribute(
        "data-mxgraph",
        JSON.stringify({
          xml: e.data.xml,
          toolbar: "pages zoom layers tags",
          "toolbar-nohide": true,
          "toolbar-position": "top",
          nav: true,
          resize: true,
          "auto-fit": true,
          lightbox: false,
          highlight: "#3b82f6",
          "dark-mode": false,
        })
      );
      container.appendChild(div);
      GraphViewer.createViewerForElement(div, function () {
        send({ type: "rendered", pages: pages });
      });
    } catch (err) {
      container.innerHTML = "";
      send({ type: "error", message: "This isn't a draw.io diagram the viewer can show." });
    }
  });
  send({ type: "ready" });
})();
