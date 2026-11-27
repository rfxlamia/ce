export function SampleReport() {
  return (
    <article aria-label="Sample report">
      <p>This is an illustrative example, not the result of a real CE run.</p>
      <dl>
        <dt>Outcome</dt>
        <dd>EVIDENCED</dd>

        <dt>Change</dt>
        <dd>Pull request "Add a Save button to the profile form". It changes the form component and its stylesheet.</dd>

        <dt>Claim</dt>
        <dd>After a visitor edits the display name and activates Save, the page shows the message "Profile saved".</dd>

        <dt>Subject</dt>
        <dd>The profile page of the example web application, running locally in Chromium.</dd>

        <dt>Actions performed</dt>
        <dd>
          <ol>
            <li>Opened the profile page.</li>
            <li>Typed a new display name into the "Display name" field.</li>
            <li>Activated the "Save" button.</li>
          </ol>
        </dd>

        <dt>Observations obtained</dt>
        <dd>
          <ul>
            <li>The message "Profile saved" appeared after the Save button was activated.</li>
            <li>The "Display name" field kept the new value.</li>
            <li>The browser console reported no errors.</li>
          </ul>
        </dd>

        <dt>Where the Evidence can be inspected</dt>
        <dd>In the Evidence bundle of the run: the file run.json and the file report.html, which holds the screenshots and the list of actions.</dd>
      </dl>
    </article>
  );
}
