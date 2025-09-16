# 📄 MVP – AnyThing v0.1

### MVP Deliverables
1. **Server App (Node.js)**
   - Handles CarThing connection.  
   - Exposes API for plugins.  
   - Built-in Apple Music + Media Control plugins.  

2. **CLI Tool**
   - `anything plugins install <name>`  
   - `anything plugins list`  
   - `anything config set <button> <action>`  

3. **Apple Music Plugin (Core)**
   - Play/pause, skip, now playing info.  

4. **Macro Plugin (Core)**
   - Assign CarThing buttons/dials to OS shortcuts.  

5. **UI Renderer**
   - Minimal screen for plugin widgets.  
   - Touch + dial navigation.  

6. **Documentation**
   - Setup guide.  
   - Plugin developer tutorial.  
   - Contribution guidelines.  

---

### MVP Success Criteria
- CarThing connects reliably to host.  
- Apple Music control works.  
- User can remap buttons to macros.  
- Developers can write a Hello World plugin.  

---

👉 Example “Hello World” plugin (MVP-level):

```js
module.exports = {
  name: "hello-world",
  version: "0.1",
  display: { type: "text", content: "Hello AnyThing!" },
  actions: {
    onPress: () => console.log("Button pressed!"),
  },
};
```
