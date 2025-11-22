const express = require("express");
const router = express.Router();
const db = require("../db");
const fs = require("fs");
const path = require("path");

// Middleware untuk check auth (simple, bisa diperbaiki dengan session)
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect("/login");
};

// Login page
router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  // Simple authentication (ganti dengan database di production)
  if (username === "admin" && password === "admin123") {
    req.session.isAdmin = true;
    req.session.username = username;
    res.redirect("/dashboard");
  } else {
    res.render("login", { error: "Username atau password salah" });
  }
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Dashboard home
router.get("/dashboard", isAuthenticated, async (req, res) => {
  try {
    const totalUsers = await db("users").count("* as count").first();
    const totalMenus = await db("menus").count("* as count").first();
    const totalChoices = await db("menu_choices").count("* as count").first();
    const paidCount = await db("menu_choices")
      .where("status", "paid")
      .count("* as count")
      .first();

    res.render("dashboard", {
      username: req.session.username,
      stats: {
        totalUsers: totalUsers.count,
        totalMenus: totalMenus.count,
        totalChoices: totalChoices.count,
        paidCount: paidCount.count,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading dashboard");
  }
});

// QR Code page
router.get("/qr", isAuthenticated, (req, res) => {
  res.render("qr", { username: req.session.username });
});

// Users management
router.get("/users", isAuthenticated, async (req, res) => {
  try {
    const users = await db("users")
      .select("*")
      .orderBy("created_at", "desc");
    res.render("users", { username: req.session.username, users });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading users");
  }
});

router.post("/users/add", isAuthenticated, async (req, res) => {
  try {
    const { name, phone } = req.body;
    await db("users").insert({ name, phone });
    res.redirect("/users");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error adding user");
  }
});

router.post("/users/delete/:id", isAuthenticated, async (req, res) => {
  try {
    await db("users").where("id", req.params.id).delete();
    res.redirect("/users");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error deleting user");
  }
});

// Menus management
router.get("/menus", isAuthenticated, async (req, res) => {
  try {
    const menus = await db("menus")
      .select("*")
      .orderBy("created_at", "desc");
    res.render("menus", { username: req.session.username, menus });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading menus");
  }
});

router.post("/menus/add", isAuthenticated, async (req, res) => {
  try {
    const { name, price } = req.body;
    await db("menus").insert({ name, price: parseInt(price) });
    res.redirect("/menus");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error adding menu");
  }
});

router.post("/menus/delete/:id", isAuthenticated, async (req, res) => {
  try {
    await db("menus").where("id", req.params.id).delete();
    res.redirect("/menus");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error deleting menu");
  }
});

router.post("/menus/update/:id", isAuthenticated, async (req, res) => {
  try {
    const { name, price } = req.body;
    await db("menus")
      .where("id", req.params.id)
      .update({ name, price: parseInt(price) });
    res.redirect("/menus");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error updating menu");
  }
});

// Menu Choices (Gathering Data)
router.get("/gathering", isAuthenticated, async (req, res) => {
  try {
    const data = await db("menu_choices as mc")
      .join("users as u", "u.id", "mc.user_id")
      .join("menus as m", "m.id", "mc.menu_id")
      .select(
        "mc.id",
        "u.name as user_name",
        "u.phone",
        "m.name as menu_name",
        "m.price",
        "mc.status",
        "mc.created_at"
      )
      .orderBy("mc.created_at", "desc");

    // Calculate totals for each
    const dataWithTotals = data.map((row) => {
      const basePrice = row.price;
      const tax = basePrice * 0.1;
      const soundFee = 10000;
      const total = basePrice + tax + soundFee;
      return { ...row, total };
    });

    res.render("gathering", {
      username: req.session.username,
      data: dataWithTotals,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading gathering data");
  }
});

router.post("/gathering/status/:id", isAuthenticated, async (req, res) => {
  try {
    const { status } = req.body;
    await db("menu_choices").where("id", req.params.id).update({ status });
    res.redirect("/gathering");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error updating status");
  }
});

router.post("/gathering/delete/:id", isAuthenticated, async (req, res) => {
  try {
    await db("menu_choices").where("id", req.params.id).delete();
    res.redirect("/gathering");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error deleting choice");
  }
});

// Muted Users Management
router.get("/muted", isAuthenticated, (req, res) => {
  try {
    const DATA_FILE = path.join(__dirname, "..", "muted.json");
    let data = { muted: [], log: [] };
    
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }

    res.render("muted", {
      username: req.session.username,
      mutedUsers: data.muted || [],
      logs: (data.log || []).reverse().slice(0, 50), // Last 50 logs
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading muted data");
  }
});

router.post("/muted/remove", isAuthenticated, (req, res) => {
  try {
    const { userId } = req.body;
    const DATA_FILE = path.join(__dirname, "..", "muted.json");
    let data = { muted: [], log: [] };
    
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }

    data.muted = data.muted.filter((id) => id !== userId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    
    res.redirect("/muted");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error removing muted user");
  }
});

module.exports = router;
