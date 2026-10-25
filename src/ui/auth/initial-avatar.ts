// Every account needs a picture, and the first-admin setup form doesn't ask
// for one: make a plain one from the username's first letter. It can be
// changed later like any other picture.
export async function makeInitialAvatar(username: string): Promise<Blob> {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw a picture for the new account");
  ctx.fillStyle = "#1f6f8b";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(size * 0.5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((username.trim()[0] ?? "?").toUpperCase(), size / 2, size / 2);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Couldn't draw a picture for the new account")),
      "image/png",
    ),
  );
}
