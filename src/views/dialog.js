import { escapeHtml } from "../utils.js";

// In-app replacements for alert() and confirm(). In FileMaker Go the native
// ones are titled with the page's file name ("widget.html"), which means
// nothing to a tech. These carry a real title and the app's styling.
//
//   await showAlert("3 changes uploaded.", { title: "Upload complete" });
//   if (await showConfirm("Remove this?", { okLabel: "Remove", danger: true })) ...

function openDialog({ title, message, buttons }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialogTitle">
        <h2 class="dialog-title" id="dialogTitle">${escapeHtml(title)}</h2>
        <p class="dialog-message">${escapeHtml(message)}</p>
        <div class="dialog-buttons">
          ${buttons
            .map(
              (b, i) =>
                `<button type="button" class="btn ${b.className}" data-index="${i}">${escapeHtml(
                  b.label
                )}</button>`
            )
            .join("")}
        </div>
      </div>
    `;

    function finish(value) {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    }

    // Escape picks the cancel button (the first), Enter the default (the last).
    function onKeydown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(buttons[0].value);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish(buttons[buttons.length - 1].value);
      }
    }

    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-index]");
      if (btn) finish(buttons[Number(btn.dataset.index)].value);
    });
    document.addEventListener("keydown", onKeydown, true);
    document.body.appendChild(overlay);
    overlay.querySelector(".dialog-buttons button:last-child").focus();
  });
}

export function showAlert(message, { title = "Gaskets Rock" } = {}) {
  return openDialog({
    title,
    message,
    buttons: [{ label: "OK", className: "btn-primary", value: undefined }],
  });
}

export function showConfirm(
  message,
  { title = "Are you sure?", okLabel = "OK", cancelLabel = "Cancel", danger = false } = {}
) {
  return openDialog({
    title,
    message,
    buttons: [
      { label: cancelLabel, className: "btn-secondary", value: false },
      { label: okLabel, className: danger ? "btn-danger" : "btn-primary", value: true },
    ],
  });
}
