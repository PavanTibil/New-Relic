provider "google" {
  project = "starapp-backend-uat"
  region  = "asia-south1"
  zone    = "asia-south1-a"
}

resource "google_compute_instance" "vm_instance" {
  name         = "starapp-vm"
  machine_type = "e2-micro"
  zone         = "asia-south1-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
    }
  }

  network_interface {
    network = "default"

    access_config {} # gives external IP
  }

  labels = {
    starapp = "true"
  }

  tags = ["starapp"]
}
